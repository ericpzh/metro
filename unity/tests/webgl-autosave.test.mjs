import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTOSAVE_KEY } from '../../game/src/app/autosave.ts'
import { serialize } from '../../game/src/persistence/save.ts'
import { toState } from '../../game/src/build/model.ts'
import { createWebGlAutosave, readValidAutosaveText, resolveWebGlStartupAction } from '../../game/src/unity-web/webglAutosave.ts'
import { readHostHistory, reduce } from '../../game/src/unity-web/stationBridge.ts'

const makeStation = (name, nameEn = '') => toState({ name, nameEn, seed: 1, cells: [], modules: [], lines: [] })

function makeDelta(baseRevision, revision, overrides = {}) {
  return {
    schemaVersion: 1,
    baseRevision,
    revision,
    savedAt: `2026-11-23T12:00:0${revision % 10}.000Z`,
    removedCells: [],
    changedCells: [],
    removedModules: [],
    changedModules: [],
    ...overrides,
  }
}

function stripSavedAt(envelope) {
  const copy = structuredClone(envelope)
  delete copy.savedAt
  return copy
}

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
  autosave.noteCommit({ sessionId: 's-1', revision: 1, stationEpoch: 1, sourceId: 'new', documentText: VALID_SAVE_A })
  assert.equal(storage.peek(AUTOSAVE_KEY), null)

  // visibilitychange(hidden) flushes synchronously without any host round-trip.
  doc.visibilityState = 'hidden'
  doc.emit('visibilitychange')
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_A)

  // Delta commit (documentText: null, raw host delta) flushes synchronously on pagehide.
  autosave.noteCommit({
    sessionId: 's-1',
    revision: 2,
    stationEpoch: 1,
    sourceId: 'new',
    documentText: null,
    delta: makeDelta(1, 2, { name: 'Edited Station', nameEn: 'Edited' }),
  })
  win.emit('pagehide')
  assert.match(storage.peek(AUTOSAVE_KEY) ?? '', /Edited Station/)

  // Interval trigger flushes new revision after another commit (e.g. undo back to Alpha).
  autosave.noteCommit({
    sessionId: 's-1',
    revision: 3,
    stationEpoch: 1,
    sourceId: 'new',
    documentText: null,
    delta: makeDelta(2, 3, { name: 'Undo Station', nameEn: 'Alpha' }),
  })
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

  autosave.noteCommit({ sessionId: 's-1', revision: 1, stationEpoch: 1, sourceId: 'zoo', documentText: VALID_SAVE_A })
  assert.equal(autosave.flush(), true)
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_A)

  // Station replacement with quota failure must remove the old station first and not throw.
  throwOnSet = true
  autosave.noteCommit({ sessionId: 's-1', revision: 2, stationEpoch: 2, sourceId: 'file', documentText: VALID_SAVE_B })
  assert.equal(storage.peek(AUTOSAVE_KEY), null, 'previous station must be cleared before attempting replacement write')

  // Later retry succeeds once storage frees up.
  throwOnSet = false
  assert.equal(autosave.flush(), true)
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_B)
  autosave.dispose()
})

test('plan 39 §3: first accepted demo/open/new replacement invalidates stale autosave BEFORE writing, even on quota failure', () => {
  const storage = memoryStorage({ [AUTOSAVE_KEY]: VALID_SAVE_A })
  let throwOnSet = true
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

  autosave.trackCommand('c-1', 'replace')
  autosave.noteCommit({
    sessionId: 's-1',
    revision: 1,
    stationEpoch: 1,
    sourceId: 'zoo',
    commandId: 'c-1',
    documentText: VALID_SAVE_B,
  })
  assert.equal(storage.peek(AUTOSAVE_KEY), null, 'reload after quota-failed replacement must never restore stale station A')
  assert.equal(readValidAutosaveText(guardedStorage), null)

  throwOnSet = false
  assert.equal(autosave.flush(), true)
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_B)

  // Refused explicit open leaves B intact and clean.
  autosave.trackCommand('c-2', 'replace')
  autosave.noteReject('c-2')
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_B)
  assert.equal(autosave.flush(), false)

  // Repeated open of the SAME sourceId ('zoo' -> 'zoo') still invalidates & replaces cleanly.
  const VALID_SAVE_B2 = serialize(makeStation('Beta Reopened', 'Beta2'))
  throwOnSet = true
  autosave.trackCommand('c-3', 'replace')
  autosave.noteCommit({
    sessionId: 's-1',
    revision: 2,
    stationEpoch: 2,
    sourceId: 'zoo',
    commandId: 'c-3',
    documentText: VALID_SAVE_B2,
  })
  assert.equal(storage.peek(AUTOSAVE_KEY), null)
  throwOnSet = false
  assert.equal(autosave.flush(), true)
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_B2)

  // Warm resync refreshes cached envelope without wiping stored slot or marking clean dirty.
  autosave.trackCommand('c-4', 'resync')
  autosave.noteCommit({
    sessionId: 's-1',
    revision: 2,
    stationEpoch: 2,
    sourceId: 'zoo',
    commandId: 'c-4',
    documentText: VALID_SAVE_B2,
  })
  assert.equal(storage.peek(AUTOSAVE_KEY), VALID_SAVE_B2)
  assert.equal(autosave.flush(), false)
  autosave.dispose()

  // Fresh startup restoring valid autosave starts clean (no redundant write).
  const restoreOpsStart = storage.ops.length
  const restored = createWebGlAutosave({
    enabled: true,
    storage,
    windowTarget: null,
    documentTarget: null,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  })
  restored.trackCommand('c-10', 'restore')
  restored.noteCommit({
    sessionId: 's-2',
    revision: 1,
    stationEpoch: 1,
    sourceId: 'autosave',
    commandId: 'c-10',
    documentText: VALID_SAVE_B2,
  })
  assert.equal(storage.ops.length, restoreOpsStart, 'correlated autosave restore must not rewrite storage')
  assert.equal(restored.flush(), false)
  restored.dispose()
})

test('plan 39 §4 & plan 40 §2: lossless delta autosave preserves opaque metadata and extra fields, stays O(1) during adoption, coalesces encodes, and recovers from delta gaps via resync', () => {
  const storage = memoryStorage()
  const win = makeFakeTarget()
  const doc = makeFakeTarget()
  let encodeCalls = 0
  const scheduled = []
  let cancelCount = 0
  let brokenCalls = 0

  const line1 = {
    id: '1', name: '1号线', nameEn: 'Line 1', colour: '#f3d03e', stock: 'A', cars: 6,
    power: 'third-rail', psd: 'full', direction: 'up',
    headwayProfile: { peak: 150, offpeak: 240, late: 360 }, alightPerTrain: 40, modelScale: 1,
    upTerminus: '', downTerminus: '', customLineTag: 'keep-line-1',
  }
  const line2 = {
    id: '2', name: '2号线', nameEn: 'Line 2', colour: '#00629b', stock: 'A', cars: 6,
    power: 'third-rail', psd: 'full', direction: 'up',
    headwayProfile: { peak: 150, offpeak: 240, late: 360 }, alightPerTrain: 40, modelScale: 1,
    upTerminus: '', downTerminus: '',
  }
  const cellA = { x: 0, y: 0, z: -5, fill: 'solid', zone: 'unpaid', customCellMeta: { note: 'authored' } }
  const cellB = { x: 1, y: 0, z: -5, fill: 'solid', zone: 'unpaid' }
  const bench1 = {
    id: 'bench-1', type: 'bench', x: 0, y: 0, z: -5, rot: 0, w: 1, h: 1, d: 1,
    customModMeta: 'preserve-me', cfg: { variant: 'steel-1', customCfg: 42 },
  }
  const bench2 = { id: 'bench-2', type: 'bench', x: 1, y: 0, z: -5, rot: 0, w: 1, h: 1, d: 1, cfg: { variant: 'steel-1' } }

  const baseEnvelope = {
    format: 'metro-save',
    formatVersion: 1,
    gameVersion: '0.2.0',
    savedAt: '2026-11-23T12:00:00.000Z',
    name: 'Metadata Station',
    nameEn: 'Meta',
    city: 'guangzhou',
    seed: 1234567,
    levelBase: 0,
    storeyHeight: 5,
    authorMetadata: { description: 'review metadata', tags: ['v1', 'parity'] },
    static: {
      cells: [cellA, cellB],
      modules: [bench1, bench2],
      lines: [line1],
    },
  }
  const baseText = JSON.stringify(baseEnvelope)

  const autosave = createWebGlAutosave({
    enabled: true,
    storage,
    windowTarget: win,
    documentTarget: doc,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    scheduleEncodeFn: fn => {
      const handle = { fn, cancelled: false }
      scheduled.push(handle)
      return handle
    },
    cancelEncodeFn: handle => {
      handle.cancelled = true
      cancelCount++
    },
    onSequenceBroken: () => { brokenCalls++ },
    encodeEnvelopeFn: text => {
      encodeCalls++
      return text
    },
  })

  // Rev 1: initial full host envelope reuses documentText with zero encode calls.
  autosave.noteCommit({
    sessionId: 's-1', revision: 1, stationEpoch: 1, sourceId: 'file', documentText: baseText,
  })
  assert.equal(encodeCalls, 0)

  // Rev 2: add Line 2.
  autosave.noteCommit({
    sessionId: 's-1', revision: 2, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(1, 2, { lines: [line1, line2] }),
  })
  // Rev 3: paint cellA (preserving customCellMeta).
  const cellAPainted = { ...cellA, finish: { top: 'floor.marble' } }
  autosave.noteCommit({
    sessionId: 's-1', revision: 3, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(2, 3, { changedCells: [cellAPainted] }),
  })
  // Rev 4: move/rotate bench-1 (preserving customModMeta & cfg.customCfg).
  const bench1Moved = { ...bench1, x: 1, rot: 1 }
  autosave.noteCommit({
    sessionId: 's-1', revision: 4, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(3, 4, { changedModules: [bench1Moved] }),
  })
  // Rev 5: undo bench-1 move.
  autosave.noteCommit({
    sessionId: 's-1', revision: 5, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(4, 5, { changedModules: [bench1] }),
  })
  // Rev 6: redo bench-1 move.
  autosave.noteCommit({
    sessionId: 's-1', revision: 6, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(5, 6, { changedModules: [bench1Moved] }),
  })

  assert.equal(encodeCalls, 0, 'commit adoption must never synchronously encode delta snapshots')
  assert.equal(cancelCount, 4, 'older scheduled encodes must be coalesced away')

  // Firing an already-superseded scheduled callback is revision-fenced and does nothing.
  scheduled[0].fn()
  assert.equal(encodeCalls, 0)

  // Trigger synchronous pagehide BEFORE the latest scheduled encode runs.
  win.emit('pagehide')
  assert.equal(encodeCalls, 1, 'synchronous pagehide encodes latest coherent revision once')

  const restoredText = readValidAutosaveText(storage)
  assert.ok(restoredText)
  const restoredObj = JSON.parse(restoredText)
  const expectedHostExport = {
    ...baseEnvelope,
    static: {
      cells: [cellAPainted, cellB],
      modules: [bench1Moved, bench2],
      lines: [line1, line2],
    },
  }
  assert.deepEqual(stripSavedAt(restoredObj), stripSavedAt(expectedHostExport),
    'restored autosave must match authoritative host export verbatim (ignoring volatile savedAt)')
  assert.deepEqual(restoredObj.authorMetadata, { description: 'review metadata', tags: ['v1', 'parity'] })
  assert.deepEqual(restoredObj.static.cells[0].customCellMeta, { note: 'authored' })
  assert.equal(restoredObj.static.modules[0].customModMeta, 'preserve-me')
  assert.equal(restoredObj.static.modules[0].cfg.customCfg, 42)
  assert.equal(restoredObj.static.lines[0].customLineTag, 'keep-line-1')

  // Subsequent idle encode coalescing: rev 7 edits city, idle runs once, flush reuses encoded text.
  autosave.noteCommit({
    sessionId: 's-1', revision: 7, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(6, 7, { city: 'shanghai' }),
  })
  assert.equal(encodeCalls, 1)
  scheduled.at(-1).fn()
  assert.equal(encodeCalls, 2)
  assert.equal(autosave.flush(), true)
  assert.equal(encodeCalls, 2, 'flush reuses coalesced pre-encoded text')
  assert.equal(JSON.parse(storage.peek(AUTOSAVE_KEY)).city, 'shanghai')

  // Delta gap (baseRevision 8 != 7): must trigger onSequenceBroken and REFUSE to overwrite storage!
  const beforeGapText = storage.peek(AUTOSAVE_KEY)
  autosave.noteCommit({
    sessionId: 's-1', revision: 9, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(8, 9, { name: 'Broken Gap' }),
  })
  assert.equal(brokenCalls, 1, 'delta gap must request host resync')
  assert.equal(autosave.flush(), false, 'must never write an incoherent revision')
  assert.equal(storage.peek(AUTOSAVE_KEY), beforeGapText)

  // Resync full envelope at rev 9 restores coherence and allows flush to write rev 9 directly (no extra encode).
  const resyncEnvelope = { ...expectedHostExport, city: 'shanghai', name: 'Recovered Rev 9' }
  const resyncText = JSON.stringify(resyncEnvelope)
  autosave.trackCommand('c-resync', 'resync')
  autosave.noteCommit({
    sessionId: 's-1', revision: 9, stationEpoch: 1, sourceId: 'file', commandId: 'c-resync', documentText: resyncText,
  })
  assert.equal(autosave.flush(), true, 'recovered coherent revision must flush cleanly')
  assert.equal(encodeCalls, 2, 'resync full envelope is reused directly without re-encoding')
  assert.equal(storage.peek(AUTOSAVE_KEY), resyncText)

  // Dispose cancels pending encode and ignores late idle callbacks.
  autosave.noteCommit({
    sessionId: 's-1', revision: 10, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: makeDelta(9, 10, { name: 'After Dispose' }),
  })
  const staleAfterDispose = scheduled.at(-1)
  autosave.dispose()
  assert.equal(win.listenerCount('beforeunload'), 0)
  staleAfterDispose.fn()
  assert.equal(encodeCalls, 2)
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

test('plan 41 §1: raw-JSON delta autosave preserves own __proto__, >53-bit integer tokens, and exact host array order across delete/undo/redo', () => {
  const storage = memoryStorage()
  const win = makeFakeTarget()
  let brokenCalls = 0

  const rawCell0 = '{"x":0,"y":0,"z":-5,"fill":"solid","zone":"unpaid","bigCellId":9007199254740995,"customCellMeta":{"note":"keep-0"}}'
  const rawCell0Painted = '{"x":0,"y":0,"z":-5,"fill":"solid","zone":"unpaid","finish":{"top":"floor.marble"},"bigCellId":9007199254740995,"customCellMeta":{"note":"keep-0"}}'
  const rawCell1 = '{"x":1,"y":0,"z":-5,"fill":"solid","zone":"unpaid"}'
  const rawCell2 = '{"x":2,"y":0,"z":-5,"fill":"solid","zone":"unpaid","__proto__":{"cellProto":true}}'

  const rawBench1 = '{"id":"bench-1","type":"bench","x":0,"y":0,"z":-5,"rot":0,"w":1,"h":1,"d":1,"bigModId":9007199254740997,"customModMeta":"keep-1","cfg":{"variant":"steel-1"}}'
  const rawBench2 = '{"id":"bench-2","type":"bench","x":1,"y":0,"z":-5,"rot":0,"w":1,"h":1,"d":1,"cfg":{"variant":"steel-1"}}'
  const rawBench3 = '{"id":"bench-3","type":"bench","x":2,"y":0,"z":-5,"rot":0,"w":1,"h":1,"d":1,"cfg":{"variant":"steel-1"}}'

  const rawLine1 = '{"id":"1","name":"1号线","nameEn":"Line 1","colour":"#f3d03e","stock":"A","cars":6,"power":"third-rail","psd":"full","direction":"up","headwayProfile":{"peak":150,"offpeak":240,"late":360},"alightPerTrain":40,"bigLineId":9007199254740999,"customLineTag":"keep-line"}'
  const rawLine2 = '{"id":"2","name":"2号线","nameEn":"Line 2","colour":"#00629b","stock":"A","cars":6,"power":"third-rail","psd":"full","direction":"up","headwayProfile":{"peak":150,"offpeak":240,"late":360},"alightPerTrain":40}'

  const buildExpected = ({ savedAt, cells, modules, lines }) =>
    `{"format":"metro-save","formatVersion":1,"gameVersion":"0.2.0","savedAt":"${savedAt}","name":"RawTokenTest","nameEn":"Raw","city":"guangzhou","seed":1,"levelBase":0,"storeyHeight":5,"__proto__":{"ownProto":true,"tag":"keep-root"},"authorMetadata":{"bigId":9007199254740993,"note":"verbatim"},"static":{"cells":[${cells.join(',')}],"modules":[${modules.join(',')}],"lines":[${lines.join(',')}]}}`

  const baseDoc = buildExpected({
    savedAt: '2026-11-23T12:00:00.000Z',
    cells: [rawCell0, rawCell1, rawCell2],
    modules: [rawBench1, rawBench2, rawBench3],
    lines: [rawLine1],
  })

  // Feed commits through real stationBridge.reduce to verify wire parsing of *Json + *Indices fields.
  let snap = {
    ready: true, sessionId: 's-41', revision: -1, stationEpoch: 0,
    sourceId: null, sourceHash: null, sourceHashRevision: -1,
    document: null, documentRevision: -1, delta: null, adoptedRevision: -1,
    resyncNeeded: false, lastAdoptMs: 0, lastCommitId: '', lastCommitLineId: null,
    state: {}, capabilities: {}, rejects: [],
  }
  const autosave = createWebGlAutosave({
    enabled: true,
    storage,
    windowTarget: win,
    documentTarget: null,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    scheduleEncodeFn: () => 1,
    cancelEncodeFn: () => {},
    onSequenceBroken: () => { brokenCalls++ },
  })

  const deliverCommit = (reply) => {
    const rawReplyText = JSON.stringify(reply)
    const parsedReply = JSON.parse(rawReplyText)
    snap = reduce(snap, parsedReply)
    assert.equal(snap.resyncNeeded, false, `commit rev ${reply.revision} must parse cleanly`)
    autosave.noteCommit({
      sessionId: snap.sessionId,
      revision: snap.revision,
      stationEpoch: snap.stationEpoch,
      sourceId: snap.sourceId,
      commandId: snap.lastCommitId,
      documentText: snap.document,
      delta: snap.delta,
    })
  }

  // Rev 1: open base fixture.
  deliverCommit({
    kind: 'commit', id: 'c-open', sessionId: 's-41', revision: 1,
    payload: { stationEpoch: 1, sourceId: 'file', document: baseDoc },
  })

  // Rev 2: add Line 2 via wire linesJson (no duplicate lines array).
  deliverCommit({
    kind: 'commit', id: 'c-line', sessionId: 's-41', revision: 2,
    payload: {
      stationEpoch: 1, lineId: '2',
      delta: {
        schemaVersion: 1, baseRevision: 1, revision: 2, savedAt: '2026-11-23T12:00:02.000Z',
        name: 'RawTokenTest', nameEn: 'Raw', city: 'guangzhou', levelBase: 0, storeyHeight: 5,
        removedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModulesJson: [], changedModuleIndices: [],
        linesJson: [rawLine1, rawLine2],
      },
    },
  })
  assert.equal(snap.delta.lines.length, 2, 'bridge derives parsed lines for UI store')
  assert.equal(snap.delta.linesJson.length, 2, 'bridge preserves raw linesJson for autosave')

  // Rev 3: paint cell 0 via wire changedCellsJson (contains 9007199254740995).
  deliverCommit({
    kind: 'commit', id: 'c-paint', sessionId: 's-41', revision: 3,
    payload: {
      stationEpoch: 1,
      delta: {
        schemaVersion: 1, baseRevision: 2, revision: 3, savedAt: '2026-11-23T12:00:03.000Z',
        name: 'RawTokenTest', nameEn: 'Raw', city: 'guangzhou', levelBase: 0, storeyHeight: 5,
        removedCells: [], changedCellsJson: [rawCell0Painted], changedCellIndices: [0],
        removedModules: [], changedModulesJson: [], changedModuleIndices: [],
      },
    },
  })
  assert.equal(snap.delta.changedCells[0].x, 0, 'bridge derives parsed changedCells for UI store')

  // Rev 4: delete first of three modules (bench-1).
  deliverCommit({
    kind: 'commit', id: 'c-rm-mod', sessionId: 's-41', revision: 4,
    payload: {
      stationEpoch: 1,
      delta: {
        schemaVersion: 1, baseRevision: 3, revision: 4, savedAt: '2026-11-23T12:00:04.000Z',
        name: 'RawTokenTest', nameEn: 'Raw', city: 'guangzhou', levelBase: 0, storeyHeight: 5,
        removedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: ['bench-1'], changedModulesJson: [], changedModuleIndices: [],
      },
    },
  })

  // Rev 5: undo deleting bench-1 (restored at target index 0, NOT appended to end!).
  deliverCommit({
    kind: 'commit', id: 'c-undo-mod', sessionId: 's-41', revision: 5,
    payload: {
      stationEpoch: 1,
      delta: {
        schemaVersion: 1, baseRevision: 4, revision: 5, savedAt: '2026-11-23T12:00:05.000Z',
        name: 'RawTokenTest', nameEn: 'Raw', city: 'guangzhou', levelBase: 0, storeyHeight: 5,
        removedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModulesJson: [rawBench1], changedModuleIndices: [0],
      },
    },
  })

  // Cold pagehide flush before any idle encode!
  win.emit('pagehide')
  const flushedAfterModUndo = storage.peek(AUTOSAVE_KEY)
  assert.equal(
    flushedAfterModUndo,
    buildExpected({
      savedAt: '2026-11-23T12:00:05.000Z',
      cells: [rawCell0Painted, rawCell1, rawCell2],
      modules: [rawBench1, rawBench2, rawBench3],
      lines: [rawLine1, rawLine2],
    }),
    'autosave after module delete+undo must match host export character-for-character including __proto__, >53-bit ints, and exact order',
  )
  assert.match(flushedAfterModUndo, /"__proto__":\{"ownProto":true,"tag":"keep-root"\}/)
  assert.match(flushedAfterModUndo, /"bigId":9007199254740993\b/)
  assert.match(flushedAfterModUndo, /"bigCellId":9007199254740995\b/)
  assert.match(flushedAfterModUndo, /"bigModId":9007199254740997\b/)
  assert.match(flushedAfterModUndo, /"bigLineId":9007199254740999\b/)
  assert.equal(readValidAutosaveText(storage), flushedAfterModUndo, 'readValidAutosaveText must accept & preserve raw text verbatim')

  // Rev 6: delete cells 0 and 2, then Rev 7: undo restoring both at indices [2, 0] (unsorted input).
  deliverCommit({
    kind: 'commit', id: 'c-rm-cells', sessionId: 's-41', revision: 6,
    payload: {
      stationEpoch: 1,
      delta: {
        schemaVersion: 1, baseRevision: 5, revision: 6, savedAt: '2026-11-23T12:00:06.000Z',
        name: 'RawTokenTest', nameEn: 'Raw', city: 'guangzhou', levelBase: 0, storeyHeight: 5,
        removedCells: [[0, 0, -5], [2, 0, -5]], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModulesJson: [], changedModuleIndices: [],
      },
    },
  })
  assert.equal(autosave.flush(), true)
  assert.equal(
    storage.peek(AUTOSAVE_KEY),
    buildExpected({
      savedAt: '2026-11-23T12:00:06.000Z',
      cells: [rawCell1],
      modules: [rawBench1, rawBench2, rawBench3],
      lines: [rawLine1, rawLine2],
    }),
  )

  deliverCommit({
    kind: 'commit', id: 'c-undo-cells', sessionId: 's-41', revision: 7,
    payload: {
      stationEpoch: 1,
      delta: {
        schemaVersion: 1, baseRevision: 6, revision: 7, savedAt: '2026-11-23T12:00:07.000Z',
        name: 'RawTokenTest', nameEn: 'Raw', city: 'guangzhou', levelBase: 0, storeyHeight: 5,
        removedCells: [], changedCellsJson: [rawCell2, rawCell0Painted], changedCellIndices: [2, 0],
        removedModules: [], changedModulesJson: [], changedModuleIndices: [],
      },
    },
  })
  assert.equal(autosave.flush(), true)
  assert.equal(
    storage.peek(AUTOSAVE_KEY),
    buildExpected({
      savedAt: '2026-11-23T12:00:07.000Z',
      cells: [rawCell0Painted, rawCell1, rawCell2],
      modules: [rawBench1, rawBench2, rawBench3],
      lines: [rawLine1, rawLine2],
    }),
    'multi-cell delete+undo must restore exact host cell order even when delta indices are unsorted',
  )

  // Out-of-bounds target index marks sequence broken and refuses to overwrite valid autosave.
  const validBeforeBadIdx = storage.peek(AUTOSAVE_KEY)
  deliverCommit({
    kind: 'commit', id: 'c-bad-idx', sessionId: 's-41', revision: 8,
    payload: {
      stationEpoch: 1,
      delta: {
        schemaVersion: 1, baseRevision: 7, revision: 8, savedAt: '2026-11-23T12:00:08.000Z',
        name: 'RawTokenTest', nameEn: 'Raw', city: 'guangzhou', levelBase: 0, storeyHeight: 5,
        removedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModulesJson: ['{"id":"bench-99","type":"bench","x":3,"y":0,"z":-5,"rot":0}'], changedModuleIndices: [99],
      },
    },
  })
  assert.equal(autosave.flush(), false, 'out-of-bounds target index must refuse flush')
  assert.equal(brokenCalls, 1, 'out-of-bounds target index must trigger resync')
  assert.equal(storage.peek(AUTOSAVE_KEY), validBeforeBadIdx)

  autosave.dispose()
})

test('plan 42 §3: autosave validates final positions for existing/moved/inserted cells & modules, rejects invalid indices/conflicts/missing indices without writing, and recovers via resync', () => {
  const rawCell0 = '{"x":0,"y":0,"z":0,"fill":"solid","bigCellId":9007199254740995}'
  const rawCell1 = '{"x":1,"y":0,"z":0,"fill":"solid","zone":"unpaid"}'
  const rawCell2 = '{"x":2,"y":0,"z":0,"fill":"solid","zone":"unpaid"}'
  const rawCell0Void = '{"x":0,"y":0,"z":0,"fill":"void","bigCellId":9007199254740995}'
  const rawCell1Painted = '{"x":1,"y":0,"z":0,"fill":"solid","zone":"paid"}'
  const rawCellX = '{"x":9,"y":0,"z":0,"fill":"solid","zone":"unpaid"}'

  const rawMod0 = '{"id":"bench-1","type":"bench","x":0,"y":0,"z":0,"rot":0,"bigModId":9007199254740997}'
  const rawMod1 = '{"id":"bench-2","type":"bench","x":1,"y":0,"z":0,"rot":0}'
  const rawMod2 = '{"id":"bench-3","type":"bench","x":2,"y":0,"z":0,"rot":0}'
  const rawMod0Rot = '{"id":"bench-1","type":"bench","x":0,"y":0,"z":0,"rot":1,"bigModId":9007199254740997}'
  const rawMod1Rot = '{"id":"bench-2","type":"bench","x":1,"y":0,"z":0,"rot":2}'
  const rawModX = '{"id":"bench-x","type":"bench","x":9,"y":0,"z":0,"rot":0}'

  const buildDoc = (cells, modules, savedAt = '2026-11-23T12:00:00.000Z') =>
    `{"format":"metro-save","formatVersion":1,"savedAt":"${savedAt}","name":"Fixture","city":"guangzhou","levelBase":0,"storeyHeight":5,"__proto__":{"keep":true},"bigRoot":9007199254740993,"static":{"cells":[${cells.join(',')}],"modules":[${modules.join(',')}],"lines":[]}}`

  const assertInvalidDeltaRejected = (label, baseCells, baseMods, badDeltaOverrides) => {
    const storage = memoryStorage()
    let brokenCalls = 0
    const baseDoc = buildDoc(baseCells, baseMods, '2026-11-23T12:00:00.000Z')
    const autosave = createWebGlAutosave({
      enabled: true,
      storage,
      windowTarget: null,
      documentTarget: null,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      scheduleEncodeFn: () => 1,
      cancelEncodeFn: () => {},
      onSequenceBroken: () => { brokenCalls++ },
    })

    // Seed coherent rev 1 and flush it so storage holds the last coherent autosave.
    autosave.noteCommit({ sessionId: 's-42', revision: 1, stationEpoch: 1, sourceId: 'file', documentText: baseDoc })
    assert.equal(autosave.flush(), true)
    assert.equal(storage.peek(AUTOSAVE_KEY), baseDoc)
    const setOpsBefore = storage.ops.length

    // Apply invalid delta at rev 2.
    autosave.noteCommit({
      sessionId: 's-42', revision: 2, stationEpoch: 1, sourceId: 'file', documentText: null,
      delta: {
        schemaVersion: 1, baseRevision: 1, revision: 2, savedAt: '2026-11-23T12:00:02.000Z',
        removedCells: [], changedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModules: [], changedModulesJson: [], changedModuleIndices: [],
        ...badDeltaOverrides,
      },
    })
    assert.equal(autosave.flush(), false, `${label}: invalid delta must refuse flush`)
    assert.equal(brokenCalls, 1, `${label}: invalid delta must request resync`)
    assert.equal(storage.ops.length, setOpsBefore, `${label}: invalid delta must write nothing to storage`)
    assert.equal(storage.peek(AUTOSAVE_KEY), baseDoc, `${label}: last coherent autosave must remain intact`)

    // Subsequent full resync at rev 2 restores coherence and flushes host export verbatim.
    const resyncDoc = buildDoc(baseCells, baseMods, '2026-11-23T12:00:09.000Z')
    autosave.trackCommand('c-resync', 'resync')
    autosave.noteCommit({
      sessionId: 's-42', revision: 2, stationEpoch: 1, sourceId: 'file', commandId: 'c-resync', documentText: resyncDoc,
    })
    assert.equal(autosave.flush(), true, `${label}: resync must restore flush capability`)
    assert.equal(storage.peek(AUTOSAVE_KEY), resyncDoc, `${label}: flushed resync must match host export verbatim`)
    assert.equal(readValidAutosaveText(storage), resyncDoc)
    autosave.dispose()
  }

  // 1. Out-of-range position on existing cell (review probe: index 999 in a 2-cell station).
  assertInvalidDeltaRejected('out-of-range existing cell', [rawCell0, rawCell1], [rawMod0, rawMod1], {
    changedCellsJson: [rawCell0Void], changedCellIndices: [999],
  })
  // 2. Wrong in-range position on existing cell (cell at 0 claiming 1 without remove-and-insert).
  assertInvalidDeltaRejected('wrong in-range existing cell (move without remove)', [rawCell0, rawCell1], [rawMod0, rawMod1], {
    changedCellsJson: [rawCell0Void], changedCellIndices: [1],
  })
  // 3. Out-of-range position on existing module.
  assertInvalidDeltaRejected('out-of-range existing module', [rawCell0, rawCell1], [rawMod0, rawMod1], {
    changedModulesJson: [rawMod0Rot], changedModuleIndices: [999],
  })
  // 4. Wrong in-range position on existing module (module at 0 claiming 1 without remove-and-insert).
  assertInvalidDeltaRejected('wrong in-range existing module (move without remove)', [rawCell0, rawCell1], [rawMod0, rawMod1], {
    changedModulesJson: [rawMod0Rot], changedModuleIndices: [1],
  })
  // 5. Conflicting positions: insert + existing claiming same final index.
  assertInvalidDeltaRejected('conflicting cell positions (insert + existing)', [rawCell0, rawCell1], [rawMod0, rawMod1], {
    changedCellsJson: [rawCellX, rawCell0Void], changedCellIndices: [0, 0],
  })
  // 6. Conflicting positions: two inserts claiming the same index.
  assertInvalidDeltaRejected('conflicting module positions (two inserts)', [rawCell0, rawCell1], [rawMod0], {
    changedModulesJson: [rawMod1, rawMod2], changedModuleIndices: [1, 1],
  })
  // 7. Missing positions on raw changed cell records.
  assertInvalidDeltaRejected('missing cell indices on raw records', [rawCell0, rawCell1], [rawMod0, rawMod1], {
    changedCellsJson: [rawCell0Void], changedCellIndices: undefined,
  })
  // 8. Missing positions on raw changed module records.
  assertInvalidDeltaRejected('missing module indices on raw records', [rawCell0, rawCell1], [rawMod0, rawMod1], {
    changedModulesJson: [rawMod0Rot], changedModuleIndices: undefined,
  })
  // 9. Mixed remove + insert + update where existing record declares stale pre-insert index instead of final index.
  assertInvalidDeltaRejected('stale pre-insert index on existing cell', [rawCell0, rawCell1, rawCell2], [rawMod0, rawMod1, rawMod2], {
    removedCells: [[0, 0, 0]],
    changedCellsJson: [rawCellX, rawCell1Painted],
    changedCellIndices: [0, 0], // rawCell1 sits at 0 before insert, but final index after inserting rawCellX at 0 is 1!
  })

  // 10. Valid mixed remove + update + insert AND valid move (remove + insert) for both cells and modules!
  const storage = memoryStorage()
  let brokenCalls = 0
  const baseDoc = buildDoc([rawCell0, rawCell1, rawCell2], [rawMod0, rawMod1, rawMod2], '2026-11-23T12:00:00.000Z')
  const autosave = createWebGlAutosave({
    enabled: true,
    storage,
    windowTarget: null,
    documentTarget: null,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    scheduleEncodeFn: () => 1,
    cancelEncodeFn: () => {},
    onSequenceBroken: () => { brokenCalls++ },
  })
  autosave.noteCommit({ sessionId: 's-42', revision: 1, stationEpoch: 1, sourceId: 'file', documentText: baseDoc })

  // Rev 2: Remove cell0 & mod0, insert cellX at 0 & modX at 0, update existing cell1 (final idx 1) & mod1 (final idx 1).
  // Surviving after remove: [cell1, cell2] and [mod1, mod2].
  // After inserting at 0: [cellX, cell1Painted, cell2] and [modX, mod1Rot, mod2].
  autosave.noteCommit({
    sessionId: 's-42', revision: 2, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: {
      schemaVersion: 1, baseRevision: 1, revision: 2, savedAt: '2026-11-23T12:00:02.000Z',
      removedCells: [[0, 0, 0]],
      changedCells: [],
      changedCellsJson: [rawCell1Painted, rawCellX],
      changedCellIndices: [1, 0],
      removedModules: ['bench-1'],
      changedModules: [],
      changedModulesJson: [rawMod1Rot, rawModX],
      changedModuleIndices: [1, 0],
    },
  })
  assert.equal(autosave.flush(), true, 'valid mixed remove + update + insert must flush cleanly')
  assert.equal(brokenCalls, 0)
  assert.equal(
    storage.peek(AUTOSAVE_KEY),
    buildDoc([rawCellX, rawCell1Painted, rawCell2], [rawModX, rawMod1Rot, rawMod2], '2026-11-23T12:00:02.000Z'),
  )

  // Rev 3: Valid move of cellX from index 0 to index 2 (remove + re-insert at 2) and modX from 0 to 2 (remove + re-insert at 2),
  // while also updating existing cell1Painted (now at final index 0) and mod1Rot (now at final index 0).
  autosave.noteCommit({
    sessionId: 's-42', revision: 3, stationEpoch: 1, sourceId: 'file', documentText: null,
    delta: {
      schemaVersion: 1, baseRevision: 2, revision: 3, savedAt: '2026-11-23T12:00:03.000Z',
      removedCells: [[9, 0, 0]],
      changedCells: [],
      changedCellsJson: [rawCellX, rawCell1],
      changedCellIndices: [2, 0],
      removedModules: ['bench-x'],
      changedModules: [],
      changedModulesJson: [rawModX, rawMod1],
      changedModuleIndices: [2, 0],
    },
  })
  assert.equal(autosave.flush(), true, 'valid remove-and-insert move with simultaneous existing update must flush cleanly')
  assert.equal(brokenCalls, 0)
  const finalSaved = storage.peek(AUTOSAVE_KEY)
  assert.equal(
    finalSaved,
    buildDoc([rawCell1, rawCell2, rawCellX], [rawMod1, rawMod2, rawModX], '2026-11-23T12:00:03.000Z'),
  )
  assert.match(finalSaved, /"__proto__":\{"keep":true\}/)
  assert.match(finalSaved, /"bigRoot":9007199254740993\b/)
  autosave.dispose()
})
