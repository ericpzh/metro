import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTOSAVE_KEY } from '../../game/src/app/autosave.ts'
import { serialize } from '../../game/src/persistence/save.ts'
import { toState } from '../../game/src/build/model.ts'
import { createWebGlAutosave, readValidAutosaveText, resolveWebGlStartupAction } from '../../game/src/unity-web/webglAutosave.ts'
import { readHostHistory, reduce } from '../../game/src/unity-web/stationBridge.ts'

const makeStation = (name, nameEn = '') => toState({ name, nameEn, seed: 1, cells: [], modules: [], lines: [] })

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  const ops = []
  return {
    ops,
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { ops.push(['set', key]); map.set(key, String(value)) },
    removeItem(key) { ops.push(['remove', key]); map.delete(key) },
    peek(key) { return map.has(key) ? map.get(key) : null },
  }
}

function makeFakeTarget() {
  const listeners = new Map()
  return {
    visibilityState: 'visible',
    addEventListener(type, fn) {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    emit(type) {
      for (const fn of listeners.get(type) ?? []) fn()
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }
}

const VALID_SAVE_A = serialize(makeStation('Alpha Station', 'Alpha'))
const VALID_SAVE_B = serialize(makeStation('Beta Station', 'Beta'))

test('resolveWebGlStartupAction enforces benchmark > demo > valid autosave > resync and skips desktop overlay', () => {
  const storage = memoryStorage({ [AUTOSAVE_KEY]: VALID_SAVE_A })

  assert.deepEqual(
    resolveWebGlStartupAction({ isBenchmark: true, desktopOverlay: false, demoId: 'zoo', storage }),
    { kind: 'benchmark' },
  )
  assert.deepEqual(
    resolveWebGlStartupAction({ isBenchmark: false, desktopOverlay: false, demoId: 'zoo', storage }),
    { kind: 'openDemo', id: 'zoo' },
  )
  assert.deepEqual(
    resolveWebGlStartupAction({ isBenchmark: false, desktopOverlay: false, demoId: null, storage }),
    { kind: 'openAutosave', document: VALID_SAVE_A },
  )
  assert.deepEqual(
    resolveWebGlStartupAction({ isBenchmark: false, desktopOverlay: true, demoId: null, storage }),
    { kind: 'resync' },
  )

  const corrupt = memoryStorage({ [AUTOSAVE_KEY]: '{not-valid-save-json' })
  assert.equal(readValidAutosaveText(corrupt), null)
  assert.deepEqual(
    resolveWebGlStartupAction({ isBenchmark: false, desktopOverlay: false, demoId: null, storage: corrupt }),
    { kind: 'resync' },
  )
})

test('createWebGlAutosave flushes synchronously on pagehide, visibilitychange(hidden), and interval, including delta/undo revisions', () => {
  const storage = memoryStorage()
  const win = makeFakeTarget()
  const doc = makeFakeTarget()
  let timerCb = null
  let cleared = false
  const autosave = createWebGlAutosave({
    enabled: true,
    storage,
    intervalMs: 300_000,
    windowTarget: win,
    documentTarget: doc,
    setIntervalFn: fn => { timerCb = fn; return 42 },
    clearIntervalFn: id => { if (id === 42) cleared = true },
  })

  // Initial commit caches snapshot synchronously; not flushed until trigger or epoch change.
  autosave.noteCommit({ revision: 1, stationEpoch: 1, sourceId: 'new', documentText: VALID_SAVE_A })
  assert.equal(storage.peek(AUTOSAVE_KEY), null)

  // visibilitychange(hidden) flushes synchronously without any host round-trip.
  doc.visibilityState = 'hidden'
  doc.emit('visibilitychange')
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_A)

  // Delta commit (documentText: null, station object updated, e.g. edit or undo/redo) serializes & caches synchronously.
  const edited = makeStation('Edited Station', 'Edited')
  autosave.noteCommit({ revision: 2, stationEpoch: 1, sourceId: 'new', documentText: null, station: edited })
  win.emit('pagehide')
  assert.match(storage.peek(AUTOSAVE_KEY) ?? '', /Edited Station/)

  // Interval trigger flushes new revision after another commit (e.g. undo back to Alpha).
  autosave.noteCommit({ revision: 3, stationEpoch: 1, sourceId: 'new', documentText: null, station: makeStation('Undo Station') })
  assert.ok(timerCb)
  timerCb()
  assert.match(storage.peek(AUTOSAVE_KEY) ?? '', /Undo Station/)

  autosave.dispose()
  assert.equal(cleared, true)
  assert.equal(win.listenerCount('pagehide'), 0)
  assert.equal(doc.listenerCount('visibilitychange'), 0)
})

test('createWebGlAutosave clears previous station BEFORE writing on stationEpoch replacement and tolerates quota errors', () => {
  const storage = memoryStorage()
  let throwOnSet = false
  const guardedStorage = {
    getItem: key => storage.getItem(key),
    removeItem: key => storage.removeItem(key),
    setItem(key, value) {
      if (throwOnSet) throw new Error('QuotaExceededError')
      storage.setItem(key, value)
    },
  }

  const autosave = createWebGlAutosave({
    enabled: true,
    storage: guardedStorage,
    windowTarget: null,
    documentTarget: null,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  })

  autosave.noteCommit({ revision: 1, stationEpoch: 1, sourceId: 'zoo', documentText: VALID_SAVE_A })
  assert.equal(autosave.flush(), true)
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_A)

  // Station replacement with quota failure must remove the old station first and not throw.
  throwOnSet = true
  autosave.noteCommit({ revision: 2, stationEpoch: 2, sourceId: 'file', documentText: VALID_SAVE_B })
  assert.equal(storage.peek(AUTOSAVE_KEY), null, 'previous station must be cleared before attempting replacement write')

  // Later retry succeeds once storage frees up.
  throwOnSet = false
  assert.equal(autosave.flush(), true)
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_B)
  autosave.dispose()
})

test('stationBridge reducer tracks stationEpoch and readHostHistory reflects authoritative C# undo/redo state', () => {
  const initial = {
    ready: true,
    sessionId: 's-1',
    revision: -1,
    stationEpoch: 0,
    sourceId: null,
    sourceHash: null,
    sourceHashRevision: -1,
    document: null,
    documentRevision: -1,
    delta: null,
    adoptedRevision: -1,
    resyncNeeded: false,
    lastAdoptMs: 0,
    state: {},
    capabilities: {},
    rejects: [],
  }
  const s1 = reduce(initial, {
    kind: 'commit',
    sessionId: 's-1',
    revision: 1,
    payload: {
      document: VALID_SAVE_A,
      sourceId: 'new',
      stationEpoch: 1,
      canUndo: false,
      canRedo: false,
    },
  })
  assert.equal(s1.stationEpoch, 1)
  assert.deepEqual(readHostHistory(s1), { canUndo: false, canRedo: false })

  const s2 = reduce(s1, {
    kind: 'state',
    sessionId: 's-1',
    revision: 2,
    payload: {
      stationEpoch: 1,
      canUndo: true,
      canRedo: false,
    },
  })
  assert.equal(s2.stationEpoch, 1)
  assert.deepEqual(readHostHistory(s2), { canUndo: true, canRedo: false })

  const s3 = reduce(s2, {
    kind: 'commit',
    sessionId: 's-1',
    revision: 3,
    payload: {
      document: VALID_SAVE_B,
      sourceId: 'new',
      stationEpoch: 2,
      canUndo: false,
      canRedo: false,
    },
  })
  assert.equal(s3.stationEpoch, 2)
  assert.deepEqual(readHostHistory(s3), { canUndo: false, canRedo: false })
})
