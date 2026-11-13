// Plan 11 bridge contract: envelope shape, session fencing, commit adoption and
// the queue that lets the UI ask for a station before Unity has finished booting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envelope, reduce, stationBridge, SCHEMA_VERSION } from '../../game/src/unity-web/stationBridge.ts'

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
