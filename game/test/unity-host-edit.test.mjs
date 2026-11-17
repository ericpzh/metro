// Plan 27 §4: while a host owns the committed document, the document verbs the player
// presses belong to the host too — Ctrl+Z/Y, Delete on the selection and Escape.
//
// The app asks `hostOwnsVerb(...)` once per intent. It answers false in three cases that all
// have to keep the plain Three app working:
//
//  * nothing registered (the plain app runs its own undo/redo/delete);
//  * a host registered but not holding a station (the Unity shell before the first commit);
//  * a host that refuses the verb (it does not implement it, or it had nothing to do).
//
// Only a positive answer lets the app skip its own store path, so a half-implemented host can
// never swallow an edit.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hostOwnsVerb,
  registerStationHostCommit,
  stationHostCommit,
} from '../src/app/stationHostBridge.ts'

function port(overrides = {}) {
  const calls = []
  const record = name => (...args) => { calls.push({ name, args }); return overrides[name]?.() ?? true }
  return {
    calls,
    ownsStation: () => overrides.ownsStation?.() ?? true,
    commitSignBoards: () => true,
    undo: record('undo'),
    redo: record('redo'),
    deleteSelection: record('deleteSelection'),
    cancelGesture: record('cancelGesture'),
  }
}

test.afterEach(() => registerStationHostCommit(null))

test('the plain app has no host verbs at all', () => {
  assert.equal(stationHostCommit(), null)
  for (const verb of ['undo', 'redo', 'deleteSelection', 'cancelGesture']) {
    assert.equal(hostOwnsVerb(verb), false, verb + ' must fall back to the store path')
  }
})

test('a host that does not hold a station never steals a verb', () => {
  const host = port({ ownsStation: () => false })
  registerStationHostCommit(host)
  assert.equal(hostOwnsVerb('undo'), false)
  assert.equal(host.calls.length, 0, 'a host without the station is not even asked')
})

test('a registered host that takes a verb claims it, and only that one', () => {
  const host = port()
  registerStationHostCommit(host)
  assert.equal(hostOwnsVerb('undo'), true)
  assert.deepEqual(host.calls.map(call => call.name), ['undo'])
  assert.equal(hostOwnsVerb('redo'), true)
  assert.equal(hostOwnsVerb('deleteSelection'), true)
  assert.equal(hostOwnsVerb('cancelGesture'), true)
  assert.deepEqual(host.calls.map(call => call.name), ['undo', 'redo', 'deleteSelection', 'cancelGesture'])
})

test('a host that refuses a verb falls back to the app', () => {
  const host = port({ deleteSelection: () => false })
  registerStationHostCommit(host)
  // A selection with no module or block behind it, or an unimplemented verb: the app keeps
  // its own path rather than believing the host edited something.
  assert.equal(hostOwnsVerb('deleteSelection'), false)
  assert.equal(hostOwnsVerb('undo'), true, 'the other verbs still go to the host')
})

test('unregistering the host restores the plain app', () => {
  registerStationHostCommit(port())
  assert.equal(hostOwnsVerb('undo'), true)
  registerStationHostCommit(null)
  assert.equal(hostOwnsVerb('undo'), false)
  assert.equal(hostOwnsVerb('deleteSelection'), false)
})
