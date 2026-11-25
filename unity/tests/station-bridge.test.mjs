// Plan 11 bridge contract: envelope shape, session fencing, commit adoption and
// the queue that lets the UI ask for a station before Unity has finished booting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envelope, reduce, stationBridge, SCHEMA_VERSION, STATION_DELTA_SCHEMA_VERSION } from '../../game/src/unity-web/stationBridge.ts'
import { applyStationDelta, seedStationCellIndex } from '../../game/src/unity-web/stationDelta.ts'
import { unityHostOwnsStation } from '../../game/src/unity-web/signCommitAdapter.ts'
import { parse } from '../../game/src/persistence/save.ts'

const empty = { ready: false, sessionId: 's-1', revision: -1, sourceId: null, sourceHash: null, document: null, documentRevision: -1, state: {}, capabilities: {}, rejects: [] }

test('an envelope carries the schema version, command id, session and expected revision', () => {
  const message = envelope('station.save', { a: 1 }, { id: 'c-9', sessionId: 's-4', expectedRevision: 7 })
  assert.deepEqual(message, { schemaVersion: SCHEMA_VERSION, id: 'c-9', sessionId: 's-4', type: 'station.save', expectedRevision: 7, payload: { a: 1 } })
  assert.equal('expectedRevision' in envelope('camera.orbit', { dx: 1 }, { sessionId: 's-4' }), false)
})

test('a reply from another session is fenced out', () => {
  const current = { ...empty, revision: 3 }
  assert.equal(reduce(current, { sessionId: 's-old', kind: 'state', revision: 9, payload: { level: -10 } }), current)
})

test('a commit adopts the document once and keeps the rest of the state', () => {
  const next = reduce({ ...empty, state: { level: 0 } }, {
    sessionId: 's-1', kind: 'commit', revision: 4,
    payload: { document: '{"format":"metro-save"}', sourceId: 'zoo', sourceHash: 'abc', capabilities: { paint: true } },
  })
  assert.equal(next.revision, 4)
  assert.equal(next.document, '{"format":"metro-save"}')
  assert.equal(next.documentRevision, 4)
  assert.equal(next.sourceId, 'zoo')
  assert.equal(next.sourceHash, 'abc')
  assert.equal(next.sourceHashRevision, 4)
  assert.equal(next.capabilities.paint, true)
  assert.equal(next.state.level, 0)
})

test('a state reply never replaces the committed document', () => {
  const committed = reduce(empty, { sessionId: 's-1', kind: 'commit', revision: 2, payload: { document: '{"a":1}' } })
  const moved = reduce(committed, { sessionId: 's-1', kind: 'state', revision: 2, payload: { level: -15 } })
  assert.equal(moved.document, '{"a":1}')
  assert.equal(moved.documentRevision, 2)
  assert.equal(moved.state.level, -15)
})

test('a rejection is recorded with its command type and does not move the revision', () => {
  const current = { ...empty, revision: 5 }
  const rejected = reduce(current, { sessionId: 's-1', kind: 'reject', id: 'c-3', revision: 5, code: 'revision-mismatch' })
  assert.equal(rejected.revision, 5)
  assert.deepEqual(rejected.rejects.at(-1), { id: 'c-3', type: '', code: 'revision-mismatch' })
})

test('commands sent before register wait for the player and flush exactly once', () => {
  const sent = []
  stationBridge.send('station.openDemo', { id: 'zoo' })
  assert.equal(sent.length, 0)
  stationBridge.register({ SendMessage: (object, method, value) => sent.push({ object, method, value }) })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].object, 'StationGame')
  assert.equal(sent[0].method, 'BrowserCommand')
  const message = JSON.parse(sent[0].value)
  assert.equal(message.type, 'station.openDemo')
  assert.deepEqual(message.payload, { id: 'zoo' })
  assert.ok(message.sessionId.length > 0)
  stationBridge.unregister()
})

/* ------------------------------------------------------- plan 29 §5 camera cadence */

test('Unity audio cues and ambience reach only the current session without altering the station snapshot', () => {
  const received = []
  const stop = stationBridge.onAudio(payload => received.push(payload))
  try {
    stationBridge.register({ SendMessage() {} })
    const snapshot = stationBridge.getSnapshot()
    const deliver = (sessionId, payload) => stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION, kind: 'audio', sessionId, payload,
    }))
    const frame = { position: [0, 0, 0], right: [1, 0, 0], sources: [], speed: 1 }
    deliver('old-session', { cue: 'delete' })
    deliver(snapshot.sessionId, { cue: 'place' })
    deliver(snapshot.sessionId, frame)
    assert.deepEqual(received, [{ cue: 'place' }, frame])
    assert.equal(stationBridge.getSnapshot(), snapshot)
    stop()
    deliver(snapshot.sessionId, { cue: 'pick' })
    assert.equal(received.length, 2)
  } finally {
    stop()
    stationBridge.unregister()
  }
})

const cubeCamera = (x, sequence) => ({
  right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, x], fov: 45, ortho: false, level: 0, sequence,
})

test('a camera ack carries the applied camera and view into the snapshot state', () => {
  const base = { ...empty, revision: 2, state: { level: -5, camera: { sequence: 1, back: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] } } }
  const next = reduce(base, {
    sessionId: 's-1', kind: 'ack', revision: 2,
    payload: { camera: cubeCamera(0.5, 2), view: { level: -5 }, level: -5 },
  })
  assert.equal(next.state.camera.back[2], 0.5, 'the ack camera reaches the shell without waiting for the state interval')
  assert.deepEqual(next.state.view, { level: -5 })
  assert.equal(next.document, null, 'an ack still never touches the document')
  // A rejection merges nothing, even when it carries a payload.
  const rejected = reduce(base, {
    sessionId: 's-1', kind: 'reject', revision: 2, code: 'camera-failed',
    payload: { camera: cubeCamera(9, 9), reason: 'no' },
  })
  assert.equal(rejected.state.camera.back[2], 0, 'a refusal does not move the camera')
})

test('a minimal no-op camera ack keeps snapshot reference identity and does not notify subscribers', () => {
  const base = { ...empty, ready: true, revision: 2, state: { level: -5 } }
  const next = reduce(base, {
    sessionId: 's-1', kind: 'ack', revision: 2,
    payload: { revision: 2 },
  })
  assert.equal(next, base, 'an unchanged empty ack returns the exact same snapshot reference')

  let notifications = 0
  const unsub = stationBridge.subscribe(() => { notifications++ })
  try {
    stationBridge.register({ SendMessage: () => {} })
    const session = stationBridge.getSnapshot().sessionId
    stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION, kind: 'commit', id: 'c-init', sessionId: session, revision: 2,
      payload: { document: '{"format":"metro-save"}', sourceId: 'tianhe', sourceHash: 'h2' },
    }))
    notifications = 0
    const before = stationBridge.getSnapshot()
    stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION, kind: 'ack', id: 'c-orbit-1', sessionId: session, revision: 2,
      accepted: true, payload: { revision: 2 },
    }))
    assert.equal(stationBridge.getSnapshot(), before, 'live bridge snapshot stays identical on minimal ack')
    assert.equal(notifications, 0, 'subscribers are not woken on minimal camera acks')
  } finally {
    unsub()
    stationBridge.unregister()
  }
})

test('the frame-cadence camera pose channel is fenced by session and skips the reducer', () => {
  const poses = []
  const stop = stationBridge.onCameraPose((camera, sequence) => poses.push({ camera, sequence }))
  try {
    stationBridge.register({ SendMessage: () => {} })
    const session = stationBridge.getSnapshot().sessionId
    stationBridge.receive(JSON.stringify({
      schemaVersion: 2, kind: 'camera', id: '', sessionId: session, revision: 0,
      payload: { camera: cubeCamera(0.25, 3), sequence: 3 },
    }))
    assert.equal(poses.length, 1)
    assert.equal(poses[0].sequence, 3)
    assert.equal(poses[0].camera.back[2], 0.25)
    assert.equal(stationBridge.getSnapshot().revision, -1, 'a pose is not a state reply')
    assert.deepEqual(stationBridge.getSnapshot().state, {}, 'a pose never enters the state map')
    stationBridge.receive(JSON.stringify({
      schemaVersion: 2, kind: 'camera', id: '', sessionId: 's-stale', revision: 0,
      payload: { camera: cubeCamera(0.9, 4), sequence: 4 },
    }))
    assert.equal(poses.length, 1, 'another session cannot steer this cube')
  } finally {
    stop()
    stationBridge.unregister()
  }
})

/* ----------------------------------------------------- plan 32 §F delta commits */

test('sequential delta commits update revision, clear deferred sourceHash, reject duplicates, and preserve module/line references', () => {
  const baseDoc = JSON.stringify({
    format: 'metro-save',
    formatVersion: 1,
    gameVersion: '0.2.0',
    savedAt: '2026-01-01T00:00:00Z',
    name: 'Delta Probe',
    nameEn: 'Delta Probe',
    city: 'guangzhou',
    seed: 42,
    levelBase: 0,
    storeyHeight: 5,
    static: {
      cells: [
        { x: 0, y: 0, z: -5, fill: 'solid' },
        { x: 1, y: 0, z: -5, fill: 'solid' },
      ],
      modules: [
        { id: 'tvm-1', type: 'tvm', x: 0, y: 0, z: -5, rot: 0, cfg: {} },
      ],
      lines: [
        { id: '1', name: 'Line 1', colour: '#f0b429', direction: 'both', stock: 'B', cars: 6, power: 'overhead' },
      ],
    },
  })

  const parsed0 = parse(baseDoc)
  assert.equal(parsed0.ok, true)
  seedStationCellIndex(parsed0.state.cells)

  const snap0 = reduce({ ...empty, ready: true }, {
    sessionId: 's-1',
    kind: 'commit',
    revision: 0,
    payload: { document: baseDoc, sourceId: 'probe', sourceHash: 'hash-0', sourceHashRevision: 0 },
  })
  assert.equal(unityHostOwnsStation({ getSnapshot: () => snap0, send: () => '' }), true)

  // Apply cell-only delta (rev 0 -> 1) with deferred sourceHash (""):
  const delta1 = {
    schemaVersion: STATION_DELTA_SCHEMA_VERSION,
    baseRevision: 0,
    revision: 1,
    removedCells: [[1, 0, -5]],
    changedCells: [{ x: 2, y: 0, z: -5, fill: 'solid', finish: { top: 'floor.marble' } }],
    removedModules: [],
    changedModules: [],
    sourceHash: '',
    sourceHashRevision: 0,
  }
  const snap1 = reduce(snap0, {
    sessionId: 's-1',
    kind: 'commit',
    revision: 1,
    payload: { delta: delta1, sourceId: 'probe', sourceHash: '', sourceHashRevision: 0, level: -5 },
  })
  assert.equal(snap1.revision, 1)
  assert.equal(snap1.document, null, 'stale save string is cleared on delta commit')
  assert.equal(snap1.documentRevision, 0)
  assert.equal(snap1.sourceHash, null, 'deferred hash is null rather than pretending hash-0 belongs to rev 1')
  assert.equal(snap1.sourceHashRevision, 0)
  assert.equal(snap1.resyncNeeded, false)
  assert.equal(unityHostOwnsStation({ getSnapshot: () => snap1, send: () => '' }), true)

  // Duplicate and out-of-order deltas are rejected cleanly:
  assert.equal(reduce(snap1, { sessionId: 's-1', kind: 'commit', revision: 1, payload: { delta: delta1 } }), snap1)
  assert.equal(reduce(snap1, { sessionId: 's-1', kind: 'commit', revision: 0, payload: { delta: delta1 } }), snap1)

  const state1 = applyStationDelta(parsed0.state, snap1.delta)
  assert.equal(state1.modules, parsed0.state.modules, 'untouched modules array keeps exact reference identity')
  assert.equal(state1.lines, parsed0.state.lines, 'untouched lines array keeps exact reference identity')
  assert.equal(state1.cells.length, 2)
  assert.equal(state1.cells.some(c => c.x === 1 && c.y === 0 && c.z === -5), false)
  assert.equal(state1.cells.find(c => c.x === 2 && c.y === 0 && c.z === -5)?.finish?.top, 'floor.marble')

  // Apply module delta (rev 1 -> 2):
  const delta2 = {
    schemaVersion: STATION_DELTA_SCHEMA_VERSION,
    baseRevision: 1,
    revision: 2,
    removedCells: [],
    changedCells: [],
    removedModules: ['tvm-1'],
    changedModules: [{ id: 'bench-2', type: 'bench', x: 2, y: 0, z: -5, rot: 1, cfg: {} }],
  }
  const snap2 = reduce({ ...snap1, adoptedRevision: 1 }, {
    sessionId: 's-1',
    kind: 'commit',
    revision: 2,
    payload: { delta: delta2, sourceId: 'probe', sourceHash: '', sourceHashRevision: 0 },
  })
  assert.equal(snap2.revision, 2)
  const state2 = applyStationDelta(state1, snap2.delta)
  assert.equal(state2.cells, state1.cells, 'untouched cells array keeps exact reference identity')
  assert.equal(state2.modules.length, 1)
  assert.equal(state2.modules[0].id, 'bench-2')
})

test('a revision gap on a delta commit requests one coalesced station.resync and recovers on full snapshot', async () => {
  const sent = []
  const commits = []
  const stop = stationBridge.onCommit(s => commits.push(s.revision))
  try {
    stationBridge.register({
      SendMessage: (_obj, _method, raw) => {
        const msg = JSON.parse(raw)
        sent.push(msg)
        if (msg.type === 'station.save') {
          stationBridge.receive(JSON.stringify({
            schemaVersion: 2,
            kind: 'ack',
            id: msg.id,
            sessionId: msg.sessionId,
            revision: stationBridge.getSnapshot().revision,
            accepted: true,
            payload: { revision: stationBridge.getSnapshot().revision, sourceId: 'zoo', sourceHash: 'hash-saved', document: '{"format":"metro-save","saved":true}' },
          }))
        }
      },
    })
    const session = stationBridge.getSnapshot().sessionId
    stationBridge.receive(JSON.stringify({
      schemaVersion: 2,
      kind: 'commit',
      id: 'c-open',
      sessionId: session,
      revision: 0,
      payload: { document: '{"format":"metro-save","rev":0}', sourceId: 'zoo', sourceHash: 'h0' },
    }))
    stationBridge.noteAdopted(0, 0.2)
    assert.deepEqual(commits, [0])

    // Send a delta with a revision gap (baseRevision 2 != current 0):
    sent.length = 0
    stationBridge.receive(JSON.stringify({
      schemaVersion: 2,
      kind: 'commit',
      id: 'c-gap-1',
      sessionId: session,
      revision: 3,
      payload: {
        delta: {
          schemaVersion: STATION_DELTA_SCHEMA_VERSION,
          baseRevision: 2,
          revision: 3,
          removedCells: [],
          changedCells: [],
          removedModules: [],
          changedModules: [],
        },
      },
    }))
    // A second gapped delta while resync is already in flight must NOT spam a second resync:
    stationBridge.receive(JSON.stringify({
      schemaVersion: 2,
      kind: 'commit',
      id: 'c-gap-2',
      sessionId: session,
      revision: 4,
      payload: {
        delta: {
          schemaVersion: STATION_DELTA_SCHEMA_VERSION,
          baseRevision: 3,
          revision: 4,
          removedCells: [],
          changedCells: [],
          removedModules: [],
          changedModules: [],
        },
      },
    }))
    assert.equal(stationBridge.getSnapshot().resyncNeeded, true)
    assert.equal(stationBridge.getSnapshot().revision, 0, 'unapplied gapped delta does not advance revision')
    assert.equal(sent.filter(m => m.type === 'station.resync').length, 1, 'exactly one coalesced station.resync is sent')
    assert.deepEqual(commits, [0], 'commit listeners are not fired for unapplied gapped deltas')

    // Host replies to station.resync with full document at revision 4:
    stationBridge.receive(JSON.stringify({
      schemaVersion: 2,
      kind: 'commit',
      id: sent[0].id,
      sessionId: session,
      revision: 4,
      payload: { document: '{"format":"metro-save","rev":4}', sourceId: 'zoo', sourceHash: 'h4', sourceHashRevision: 4 },
    }))
    stationBridge.noteAdopted(4, 0.4)
    assert.equal(stationBridge.getSnapshot().resyncNeeded, false)
    assert.equal(stationBridge.getSnapshot().revision, 4)
    assert.equal(stationBridge.getSnapshot().documentRevision, 4)
    assert.deepEqual(commits, [0, 4])

    // Next sequential delta (4 -> 5) succeeds, and readCommittedDocument() materializes via station.save on demand:
    stationBridge.receive(JSON.stringify({
      schemaVersion: 2,
      kind: 'commit',
      id: 'c-delta-5',
      sessionId: session,
      revision: 5,
      payload: {
        delta: {
          schemaVersion: STATION_DELTA_SCHEMA_VERSION,
          baseRevision: 4,
          revision: 5,
          removedCells: [],
          changedCells: [{ x: 1, y: 2, z: 0, fill: 'solid' }],
          removedModules: [],
          changedModules: [],
        },
        sourceHash: '',
        sourceHashRevision: 4,
      },
    }))
    assert.equal(stationBridge.getSnapshot().revision, 5)
    assert.equal(stationBridge.getSnapshot().document, null)
    const exported = await stationBridge.readCommittedDocument()
    assert.equal(exported, '{"format":"metro-save","saved":true}')
    assert.equal(stationBridge.getSnapshot().documentRevision, 5)
    assert.equal(stationBridge.getSnapshot().sourceHash, 'hash-saved')
  } finally {
    stop()
    stationBridge.unregister()
  }
})

test('applyStationDelta adopts city, bilingual name, and delta.lines while retaining untouched cells and modules', () => {
  const baseDoc = JSON.stringify({
    format: 'metro-save',
    formatVersion: 1,
    gameVersion: '0.2.0',
    savedAt: '2026-01-01T00:00:00.000Z',
    name: '体育西路',
    nameEn: 'Tiyu Xilu',
    city: 'guangzhou',
    seed: 1,
    levelBase: 0,
    storeyHeight: 5,
    static: {
      cells: [{ x: 0, y: 0, z: 0, fill: 'solid', zone: 'unpaid' }],
      modules: [],
      lines: [{
        id: '1', name: '1号线', nameEn: 'Line 1', colour: '#f3d03e',
        stock: 'B', cars: 6, power: 'third-rail', psd: 'full', direction: 'up',
        headwayProfile: { peak: 150, offpeak: 240, late: 480 }, alightPerTrain: 120,
      }],
    },
  })
  const parsed = parse(baseDoc)
  assert.equal(parsed.ok, true)
  seedStationCellIndex(parsed.state.cells)
  const next = applyStationDelta(parsed.state, {
    schemaVersion: STATION_DELTA_SCHEMA_VERSION,
    baseRevision: 1,
    revision: 2,
    name: '春熙路',
    nameEn: 'Chunxi Rd',
    city: 'chengdu',
    removedCells: [],
    changedCells: [],
    removedModules: [],
    changedModules: [],
    lines: [
      {
        id: '1', name: '1号线', nameEn: 'Line 1', colour: '#ff00aa',
        stock: 'B', cars: 6, power: 'third-rail', psd: 'full', direction: 'up',
        headwayProfile: { peak: 120, offpeak: 240, late: 480 }, alightPerTrain: 120,
      },
      {
        id: '2', name: '2号线', nameEn: 'Line 2', colour: '#ed7d31',
        stock: 'B', cars: 6, power: 'third-rail', psd: 'full', direction: 'down',
        headwayProfile: { peak: 150, offpeak: 240, late: 480 }, alightPerTrain: 120,
      },
    ],
  })
  assert.equal(next.cells, parsed.state.cells)
  assert.equal(next.modules, parsed.state.modules)
  assert.equal(next.cityStyle, 'chengdu')
  assert.equal(next.name, '春熙路')
  assert.equal(next.nameEn, 'Chunxi Rd')
  assert.equal(next.lines.length, 2)
  assert.equal(next.lines[0].colour, '#ff00aa')
  assert.equal(next.lines[1].id, '2')
  assert.equal(next.lines[0].headwayProfile.peak, 120)
})
