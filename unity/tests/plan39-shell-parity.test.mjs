import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { reduce, stationBridge } from '../../game/src/unity-web/stationBridge.ts'
import { createLineSelectionTracker } from '../../game/src/unity-web/lineSelection.ts'
import { createToolAdapter } from '../../game/src/unity-web/toolAdapter.ts'
import { createCarriedMoveAdapter, readHostCarriedMove } from '../../game/src/unity-web/carriedMoveAdapter.ts'
import { noticeText } from '../../game/src/unity-web/editNotices.ts'

const root = resolve(import.meta.dirname, '../..')

function makeSnapshot(overrides = {}) {
  return {
    ready: true,
    sessionId: 's-1',
    revision: 1,
    stationEpoch: 1,
    sourceId: 'zoo',
    sourceHash: null,
    sourceHashRevision: -1,
    document: null,
    documentRevision: 1,
    delta: null,
    adoptedRevision: 1,
    resyncNeeded: false,
    lastAdoptMs: 0,
    lastCommitId: '',
    lastCommitLineId: null,
    state: {},
    capabilities: {},
    rejects: [],
    ...overrides,
  }
}

test('plan 39 §3/§5 & plan 40 §1: stationBridge.send registers intent before dispatch across synchronous SendMessage, queued startup, and async WebView2 replies', async () => {
  stationBridge.unregister()
  const events = []
  const queuedId = stationBridge.send('station.openDemo', { id: 'zoo' }, {
    beforeSend(intent) {
      events.push(`beforeSend:${intent.id}:${intent.queued}`)
    },
  })
  assert.ok(queuedId.startsWith('c-'), 'queued startup send must mint and return a non-empty command ID')
  assert.deepEqual(events, [`beforeSend:${queuedId}:true`])

  // Register a player whose SendMessage delivers the commit SYNCHRONOUSLY inside register().
  const sent = []
  const observedCommits = []
  const stopCommits = stationBridge.onCommit(snap => {
    observedCommits.push({ id: snap.lastCommitId, lineId: snap.lastCommitLineId, rev: snap.revision })
  })
  const baseDoc = JSON.stringify({
    format: 'metro-save', formatVersion: 1, name: 'Test', city: 'guangzhou', seed: 1,
    levelBase: 0, storeyHeight: 5,
    static: { cells: [], modules: [], lines: [{ id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }] },
  })
  const line1 = { id: '1', name: '1号线', color: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }
  const line2 = { id: '2', name: '2号线', color: '#00629b', stock: 'A', cars: 6, direction: 'up' }

  let syncPlayerSession = ''
  const tracker = createLineSelectionTracker()
  const storeState = {
    tool: 'rail',
    railLineId: '1',
    railDir: 'up',
    railWidth: 3,
    railRot: 0,
    railElevation: 0,
    moduleType: 'bench',
    moduleRot: 0,
    paintFinish: 'floor.concrete',
    paintMode: 'single',
    zoneBrush: 'unpaid',
    facilityRot: 0,
    curtainHeight: 4,
    roadWidth: 6,
    roadDirection: 'two-way',
    stairStyle: 'straight',
    stairWidth: 2,
    stairRise: 5,
    stairRun: 10,
    escalatorWidth: 1,
    escalatorDir: 'up',
    walkwayWidth: 1,
    walkwayDir: 'forward',
    liftSize: 2,
    psdType: 'full',
  }
  const storeListeners = new Set()
  const sentTools = []
  const adapter = createToolAdapter({
    read: () => storeState,
    send: (tool, settings) => { sentTools.push({ tool, settings }) },
    subscribe: fn => { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    applyHostTool: () => {},
  })
  const stopReconcile = stationBridge.onCommit(snap => {
    const lines = snap.delta?.lines
      ? snap.delta.lines.map(l => ({ ...line1, ...l, color: l.colour ?? l.color ?? '#00629b' }))
      : [line1]
    const res = tracker.reconcile({
      sessionId: snap.sessionId,
      stationEpoch: snap.stationEpoch,
      commitId: snap.lastCommitId ?? '',
      createdLineId: snap.lastCommitLineId ?? null,
      lines,
      currentRailLineId: storeState.railLineId,
    })
    if (res.changed || res.createdLine) {
      storeState.railLineId = res.nextRailLineId
      storeListeners.forEach(fn => fn())
    }
    stationBridge.noteAdopted(snap.revision, 0, {
      commandId: snap.lastCommitId ?? '',
      sessionId: snap.sessionId,
      stationEpoch: snap.stationEpoch,
    })
  })

  stationBridge.register({
    SendMessage(_obj, _method, json) {
      const cmd = JSON.parse(json)
      sent.push(cmd)
      syncPlayerSession = cmd.sessionId
      if (cmd.type === 'station.openDemo') {
        events.push(`sendMessage:${cmd.id}`)
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId, revision: 1, accepted: true,
          payload: { stationEpoch: 1, sourceId: 'zoo', document: baseDoc },
        }))
      } else if (cmd.type === 'edit.line.add') {
        events.push(`sendMessage:${cmd.id}`)
        // Deliver commit SYNCHRONOUSLY inside SendMessage (packed WebGL behavior!).
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId, revision: 2, accepted: true,
          payload: {
            stationEpoch: 1,
            lineId: '2',
            delta: {
              schemaVersion: 1, baseRevision: 1, revision: 2,
              removedCells: [], changedCells: [], removedModules: [], changedModules: [],
              lines: [
                { id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' },
                { id: '2', name: '2号线', colour: '#00629b', stock: 'A', cars: 6, direction: 'up' },
              ],
            },
          },
        }))
      }
    },
  })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].id, queuedId, 'flushed startup command must preserve its pre-register command ID')
  assert.equal(observedCommits[0]?.id, queuedId)

  // Now dispatch edit.line.add with beforeSend -> commit arrives BEFORE send() returns!
  const addId = stationBridge.send('edit.line.add', { direction: 'up' }, {
    expectedRevision: 1,
    beforeSend({ id, sessionId, stationEpoch }) {
      events.push(`beforeSend:${id}`)
      tracker.trackAdd(id, sessionId, stationEpoch)
    },
  })
  events.push(`returned:${addId}`)
  assert.equal(events.indexOf(`beforeSend:${addId}`) < events.indexOf(`sendMessage:${addId}`), true,
    'beforeSend must run before SendMessage executes')
  assert.equal(events.indexOf(`sendMessage:${addId}`) < events.indexOf(`returned:${addId}`), true,
    'synchronous WebGL SendMessage delivers commit before send() returns')
  assert.equal(storeState.railLineId, '2', 'synchronous WebGL commit must select newly created Line 2')
  assert.equal(sentTools.at(-1)?.settings?.lineId, '2', 'toolAdapter must push Line 2 target immediately')

  // Asynchronous WebView2-style reply: SendMessage posts asynchronously, commit arrives on a later turn.
  const asyncQueue = []
  stationBridge.register({
    SendMessage(_obj, _method, json) {
      asyncQueue.push(JSON.parse(json))
    },
  })
  const asyncSession = stationBridge.getSnapshot().sessionId
  assert.notEqual(asyncSession, syncPlayerSession)
  tracker.syncFence(asyncSession, 0)
  // Open station in new async session.
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: 'c-open-async', sessionId: asyncSession, revision: 1, accepted: true,
    payload: { stationEpoch: 1, sourceId: 'zoo', document: baseDoc },
  }))
  storeState.railLineId = '1'
  const asyncAddId = stationBridge.send('edit.line.add', { direction: 'up' }, {
    expectedRevision: 1,
    beforeSend({ id, sessionId, stationEpoch }) {
      tracker.trackAdd(id, sessionId, stationEpoch)
    },
  })
  assert.equal(storeState.railLineId, '1', 'async reply has not arrived yet')
  await Promise.resolve()
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: asyncAddId, sessionId: asyncSession, revision: 2, accepted: true,
    payload: {
      stationEpoch: 1,
      lineId: '2',
      delta: {
        schemaVersion: 1, baseRevision: 1, revision: 2,
        removedCells: [], changedCells: [], removedModules: [], changedModules: [],
        lines: [
          { id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' },
          { id: '2', name: '2号线', colour: '#00629b', stock: 'A', cars: 6, direction: 'up' },
        ],
      },
    },
  }))
  assert.equal(storeState.railLineId, '2', 'async WebView2-style commit must also select Line 2')

  // Pending intent is cleared on session change / unregister before any commit arrives.
  const staleAddId = stationBridge.send('edit.line.add', {}, {
    beforeSend({ id, sessionId, stationEpoch }) {
      tracker.trackAdd(id, sessionId, stationEpoch)
    },
  })
  tracker.syncFence('', 0)
  const afterReset = tracker.reconcile({
    sessionId: asyncSession,
    stationEpoch: 1,
    commitId: staleAddId,
    createdLineId: '3',
    lines: [line1, line2, { ...line2, id: '3', name: '3号线' }],
    currentRailLineId: '1',
  })
  assert.equal(afterReset.createdLine, null, 'disconnect/session change must clear pending add intent')
  assert.equal(afterReset.nextRailLineId, '1')

  stopReconcile()
  stopCommits()
  adapter.dispose()
  stationBridge.unregister()
})

test('plan 41 §2: queued station load + queued New Line binds intent at host dispatch across sync WebGL drain, async WebView2 drain, reject, and station replacement', async () => {
  const baseDoc = JSON.stringify({
    format: 'metro-save', formatVersion: 1, name: 'QueuedAdd', city: 'guangzhou', seed: 1,
    levelBase: 0, storeyHeight: 5,
    static: { cells: [], modules: [], lines: [{ id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }] },
  })
  const line1 = { id: '1', name: '1号线', color: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }
  const line1Raw = JSON.stringify({ id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' })
  const line2Raw = JSON.stringify({ id: '2', name: '2号线', colour: '#00629b', stock: 'A', cars: 6, direction: 'up' })

  const makeHarness = () => {
    const tracker = createLineSelectionTracker()
    const storeState = {
      tool: 'rail', railLineId: '1', railDir: 'up', railWidth: 3, railRot: 0, railElevation: 0,
      moduleType: 'bench', moduleRot: 0, paintFinish: 'floor.concrete', paintMode: 'single',
      zoneBrush: 'unpaid', facilityRot: 0, curtainHeight: 4, roadWidth: 6, roadDirection: 'two-way',
      stairStyle: 'straight', stairWidth: 2, stairRise: 5, stairRun: 10, escalatorWidth: 1,
      escalatorDir: 'up', walkwayWidth: 1, walkwayDir: 'forward', liftSize: 2, psdType: 'full',
    }
    const storeListeners = new Set()
    const sentTools = []
    const adapter = createToolAdapter({
      read: () => storeState,
      send: (tool, settings) => { sentTools.push({ tool, settings }) },
      subscribe: fn => { storeListeners.add(fn); return () => storeListeners.delete(fn) },
      applyHostTool: () => {},
    })
    let lastReject = stationBridge.getSnapshot().rejects.at(-1)
    const unsubBridge = stationBridge.subscribe(() => {
      const s = stationBridge.getSnapshot()
      tracker.syncFence(s.sessionId, s.stationEpoch)
      const latest = s.rejects.at(-1)
      if (latest && latest !== lastReject) {
        lastReject = latest
        tracker.noteReject(latest.id)
      }
    })
    const stopCommits = stationBridge.onCommit(snap => {
      const lines = snap.delta?.lines
        ? snap.delta.lines.map(l => ({ ...line1, ...l, color: l.colour ?? l.color ?? '#00629b' }))
        : [line1]
      const res = tracker.reconcile({
        sessionId: snap.sessionId,
        stationEpoch: snap.stationEpoch,
        commitId: snap.lastCommitId ?? '',
        createdLineId: snap.lastCommitLineId ?? null,
        lines,
        currentRailLineId: storeState.railLineId,
      })
      if (res.changed || res.createdLine) {
        storeState.railLineId = res.nextRailLineId
        storeListeners.forEach(fn => fn())
      }
      stationBridge.noteAdopted(snap.revision, 0, {
        commandId: snap.lastCommitId ?? '',
        sessionId: snap.sessionId,
        stationEpoch: snap.stationEpoch,
      })
    })
    const sendAddLine = (direction = 'up') => {
      let queuedAdd = false
      return stationBridge.send('edit.line.add', { direction }, {
        beforeSend: ({ id, queued }) => {
          queuedAdd = queued
          if (queued) tracker.reserveAdd(id)
        },
        beforeDispatch: ({ id, sessionId, stationEpoch }) => {
          if (queuedAdd) tracker.bindAdd(id, sessionId, stationEpoch)
          else tracker.trackAdd(id, sessionId, stationEpoch)
        },
        onCancel: id => {
          tracker.noteReject(id)
        },
      })
    }
    return {
      tracker, storeState, sentTools, sendAddLine,
      dispose() {
        stopCommits()
        unsubBridge()
        adapter.dispose()
      },
    }
  }

  // 1. Synchronous WebGL reply during queue drain: queue station.openDemo + edit.line.add BEFORE register().
  stationBridge.unregister()
  const syncH = makeHarness()
  const syncLoadId = stationBridge.send('station.openDemo', { id: 'zoo' })
  const syncAddId = syncH.sendAddLine('up')
  const syncSent = []
  stationBridge.register({
    SendMessage(_obj, _method, json) {
      const cmd = JSON.parse(json)
      syncSent.push(cmd)
      if (cmd.type === 'station.openDemo') {
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId, revision: 1, accepted: true,
          payload: { stationEpoch: 1, sourceId: 'zoo', document: baseDoc },
        }))
      } else if (cmd.type === 'edit.line.add') {
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId, revision: 2, accepted: true,
          payload: {
            stationEpoch: 1, lineId: '2',
            delta: {
              schemaVersion: 1, baseRevision: 1, revision: 2,
              removedCells: [], changedCellsJson: [], changedCellIndices: [],
              removedModules: [], changedModulesJson: [], changedModuleIndices: [],
              linesJson: [line1Raw, line2Raw],
            },
          },
        }))
      }
    },
  })
  assert.deepEqual(syncSent.map(c => c.id), [syncLoadId, syncAddId], 'sync drain must preserve reserved IDs in order')
  assert.equal(syncH.storeState.railLineId, '2', 'sync queued New Line must select Line 2')
  assert.equal(syncH.sentTools.at(-1)?.settings?.lineId, '2', 'toolAdapter must send Line 2 to rail tool')
  syncH.dispose()
  stationBridge.unregister()

  // 2. Asynchronous WebView2-style reply: queued New Line must WAIT until queued load is accepted & adopted!
  const asyncH = makeHarness()
  const asyncLoadId = stationBridge.send('station.openDemo', { id: 'zoo' })
  const asyncAddId = asyncH.sendAddLine('up')
  const asyncSent = []
  stationBridge.register({
    SendMessage(_obj, _method, json) {
      asyncSent.push(JSON.parse(json))
    },
  })
  const asyncSession = stationBridge.getSnapshot().sessionId
  assert.deepEqual(asyncSent.map(c => c.id), [asyncLoadId], 'queued New Line must wait until queued load commits and is adopted')
  assert.equal(asyncH.storeState.railLineId, '1')

  await Promise.resolve()
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: asyncLoadId, sessionId: asyncSession, revision: 1, accepted: true,
    payload: { stationEpoch: 1, sourceId: 'zoo', document: baseDoc },
  }))
  assert.deepEqual(asyncSent.map(c => c.id), [asyncLoadId, asyncAddId], 'queued New Line dispatches with same reserved ID right after load adoption')
  assert.equal(asyncH.storeState.railLineId, '1', 'selection stays Line 1 until add commit arrives')

  await Promise.resolve()
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: asyncAddId, sessionId: asyncSession, revision: 2, accepted: true,
    payload: {
      stationEpoch: 1, lineId: '2',
      delta: {
        schemaVersion: 1, baseRevision: 1, revision: 2,
        removedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModulesJson: [], changedModuleIndices: [],
        linesJson: [line1Raw, line2Raw],
      },
    },
  }))
  assert.equal(asyncH.storeState.railLineId, '2', 'async queued New Line must select Line 2 once adopted')
  assert.equal(asyncH.sentTools.at(-1)?.settings?.lineId, '2')
  asyncH.dispose()
  stationBridge.unregister()

  // 3. Refused queued add leaves current rail selection intact.
  const rejectH = makeHarness()
  const rejLoadId = stationBridge.send('station.openDemo', { id: 'zoo' })
  const rejAddId = rejectH.sendAddLine('up')
  const rejSent = []
  stationBridge.register({
    SendMessage(_obj, _method, json) { rejSent.push(JSON.parse(json)) },
  })
  const rejSession = stationBridge.getSnapshot().sessionId
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: rejLoadId, sessionId: rejSession, revision: 1, accepted: true,
    payload: { stationEpoch: 1, sourceId: 'zoo', document: baseDoc },
  }))
  assert.equal(rejSent.at(-1)?.id, rejAddId)
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'reject', id: rejAddId, sessionId: rejSession, revision: 1, accepted: false, code: 'refused',
    payload: { reason: 'Line limit reached' },
  }))
  // Even if a stray commit arrives later with rejAddId, selection stays Line 1.
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: rejAddId, sessionId: rejSession, revision: 2, accepted: true,
    payload: {
      stationEpoch: 1, lineId: '2',
      delta: {
        schemaVersion: 1, baseRevision: 1, revision: 2,
        removedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModulesJson: [], changedModuleIndices: [],
        linesJson: [line1Raw, line2Raw],
      },
    },
  }))
  assert.equal(rejectH.storeState.railLineId, '1', 'refused queued add must keep current rail selection intact')
  rejectH.dispose()
  stationBridge.unregister()

  // 4. Late reply after station replacement AND cancelled queued add when target load is superseded/rejected.
  const repH = makeHarness()
  const repLoadA = stationBridge.send('station.openDemo', { id: 'zoo' })
  const repAddForA = repH.sendAddLine('up')
  const repSent = []
  stationBridge.register({
    SendMessage(_obj, _method, json) { repSent.push(JSON.parse(json)) },
  })
  const repSession = stationBridge.getSnapshot().sessionId
  // Load A commits (epoch 1) -> repAddForA dispatches and binds to epoch 1.
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: repLoadA, sessionId: repSession, revision: 1, accepted: true,
    payload: { stationEpoch: 1, sourceId: 'zoo', document: baseDoc },
  }))
  assert.equal(repSent.at(-1)?.id, repAddForA)
  // Station B replaces Station A (epoch 2) BEFORE repAddForA replies.
  const repLoadB = stationBridge.send('station.openDemo', { id: 'tanwei' })
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: repLoadB, sessionId: repSession, revision: 2, accepted: true,
    payload: { stationEpoch: 2, sourceId: 'tanwei', document: baseDoc },
  }))
  // Late reply for repAddForA arrives under epoch 2 -> must NOT select Line 2!
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: repAddForA, sessionId: repSession, revision: 3, accepted: true,
    payload: {
      stationEpoch: 2, lineId: '2',
      delta: {
        schemaVersion: 1, baseRevision: 2, revision: 3,
        removedCells: [], changedCellsJson: [], changedCellIndices: [],
        removedModules: [], changedModulesJson: [], changedModuleIndices: [],
        linesJson: [line1Raw, line2Raw],
      },
    },
  }))
  assert.equal(repH.storeState.railLineId, '1', 'late reply after station replacement must keep current rail selection intact')
  repH.dispose()
  stationBridge.unregister()

  // 5. Target queued load rejected -> waiting queued add is cancelled and NEVER dispatched to a later station!
  const cancelH = makeHarness()
  const badLoad = stationBridge.send('station.openDemo', { id: 'missing' })
  const addForBadLoad = cancelH.sendAddLine('up')
  const goodLoad = stationBridge.send('station.openDemo', { id: 'zoo' })
  const cancelSent = []
  stationBridge.register({
    SendMessage(_obj, _method, json) { cancelSent.push(JSON.parse(json)) },
  })
  const cancelSession = stationBridge.getSnapshot().sessionId
  assert.deepEqual(cancelSent.map(c => c.id), [badLoad])
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'reject', id: badLoad, sessionId: cancelSession, revision: 0, accepted: false, code: 'unknown-demo',
  }))
  assert.deepEqual(cancelSent.map(c => c.id), [badLoad, goodLoad], 'add targeting rejected load must be cancelled and never dispatched to later station')
  assert.equal(cancelSent.some(c => c.id === addForBadLoad), false)
  cancelH.dispose()
  stationBridge.unregister()
})

test('plan 42 §1: FIFO station load queue keeps dependent edits with their target load across sync/async transports, per-load edits, rejects, stale-rev guards, and reconnects', async () => {
  const docA = JSON.stringify({
    format: 'metro-save', formatVersion: 1, name: 'Station A', city: 'guangzhou', seed: 1,
    levelBase: 0, storeyHeight: 5,
    static: { cells: [], modules: [], lines: [{ id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }] },
  })
  const docB = JSON.stringify({
    format: 'metro-save', formatVersion: 1, name: 'Station B', city: 'shanghai', seed: 2,
    levelBase: 0, storeyHeight: 5,
    static: { cells: [], modules: [], lines: [{ id: '1', name: '1号线', colour: '#e4002b', stock: 'A', cars: 6, direction: 'up' }] },
  })
  const line1 = { id: '1', name: '1号线', color: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }
  const line1Raw = JSON.stringify({ id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' })
  const line2Raw = JSON.stringify({ id: '2', name: '2号线', colour: '#00629b', stock: 'A', cars: 6, direction: 'up' })

  const createShellHarness = () => {
    const tracker = createLineSelectionTracker()
    const storeState = {
      tool: 'rail', railLineId: '1', railDir: 'up', railWidth: 3, railRot: 0, railElevation: 0,
      moduleType: 'bench', moduleRot: 0, paintFinish: 'floor.concrete', paintMode: 'single',
      zoneBrush: 'unpaid', facilityRot: 0, curtainHeight: 4, roadWidth: 6, roadDirection: 'two-way',
      stairStyle: 'straight', stairWidth: 2, stairRise: 5, stairRun: 10, escalatorWidth: 1,
      escalatorDir: 'up', walkwayWidth: 1, walkwayDir: 'forward', liftSize: 2, psdType: 'full',
    }
    const storeListeners = new Set()
    const sentTools = []
    const cancelled = []
    const dispatchedIntents = []
    const adapter = createToolAdapter({
      read: () => storeState,
      send: (tool, settings) => { sentTools.push({ tool, settings }) },
      subscribe: fn => { storeListeners.add(fn); return () => storeListeners.delete(fn) },
      applyHostTool: () => {},
    })
    let lastReject = stationBridge.getSnapshot().rejects.at(-1)
    const unsubBridge = stationBridge.subscribe(() => {
      const s = stationBridge.getSnapshot()
      tracker.syncFence(s.sessionId, s.stationEpoch)
      const latest = s.rejects.at(-1)
      if (latest && latest !== lastReject) {
        lastReject = latest
        tracker.noteReject(latest.id)
      }
    })
    const stopCommits = stationBridge.onCommit(snap => {
      const lines = snap.delta?.lines
        ? snap.delta.lines.map(l => ({ ...line1, ...l, color: l.colour ?? l.color ?? '#00629b' }))
        : snap.document
          ? JSON.parse(snap.document).static.lines.map(l => ({ ...line1, ...l, color: l.colour ?? l.color ?? '#00629b' }))
          : [line1]
      const res = tracker.reconcile({
        sessionId: snap.sessionId,
        stationEpoch: snap.stationEpoch,
        commitId: snap.lastCommitId ?? '',
        createdLineId: snap.lastCommitLineId ?? null,
        lines,
        currentRailLineId: storeState.railLineId,
      })
      if (res.changed || res.createdLine) {
        storeState.railLineId = res.nextRailLineId
        storeListeners.forEach(fn => fn())
      }
      stationBridge.noteAdopted(snap.revision, 0, {
        commandId: snap.lastCommitId ?? '',
        sessionId: snap.sessionId,
        stationEpoch: snap.stationEpoch,
      })
    })
    const sendAddLine = (direction = 'up', expectedRevision = undefined) => {
      let queuedAdd = false
      return stationBridge.send('edit.line.add', { direction }, {
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
        beforeSend: ({ id, queued }) => {
          queuedAdd = queued
          if (queued) tracker.reserveAdd(id)
        },
        beforeDispatch: intent => {
          dispatchedIntents.push(intent)
          if (queuedAdd) tracker.bindAdd(intent.id, intent.sessionId, intent.stationEpoch)
          else tracker.trackAdd(intent.id, intent.sessionId, intent.stationEpoch)
        },
        onCancel: (id, reason) => {
          cancelled.push({ id, reason })
          tracker.noteReject(id)
        },
      })
    }
    return {
      tracker, storeState, sentTools, cancelled, dispatchedIntents, sendAddLine,
      dispose() {
        stopCommits()
        unsubBridge()
        adapter.dispose()
      },
    }
  }

  // Simulated stateful host that enforces expectedRevision and tracks per-station line counts.
  const createMockHost = ({ sync, failLoadId = null } = { sync: true }) => {
    let rev = 0
    let epoch = 0
    let currentStation = ''
    const lineCounts = new Map()
    const sent = []
    const railSaves = []
    const pendingAsync = []

    const process = (cmd) => {
      if (cmd.type === 'station.open') {
        if (failLoadId && cmd.id === failLoadId) {
          stationBridge.receive(JSON.stringify({
            schemaVersion: 2, kind: 'reject', id: cmd.id, sessionId: cmd.sessionId,
            revision: rev, accepted: false, code: 'bad-save', payload: { reason: 'Corrupt save' },
          }))
          return
        }
        rev += 1
        epoch += 1
        currentStation = cmd.payload.sourceId
        lineCounts.set(currentStation, 1)
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId,
          revision: rev, accepted: true,
          payload: { stationEpoch: epoch, sourceId: currentStation, document: cmd.payload.document },
        }))
        return
      }
      if (cmd.type === 'edit.line.add') {
        if (cmd.expectedRevision !== undefined && cmd.expectedRevision !== rev) {
          stationBridge.receive(JSON.stringify({
            schemaVersion: 2, kind: 'reject', id: cmd.id, sessionId: cmd.sessionId,
            revision: rev, accepted: false, code: 'revision-mismatch',
          }))
          return
        }
        const baseRev = rev
        rev += 1
        const nextCount = (lineCounts.get(currentStation) ?? 1) + 1
        lineCounts.set(currentStation, nextCount)
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId,
          revision: rev, accepted: true,
          payload: {
            stationEpoch: epoch, lineId: String(nextCount),
            delta: {
              schemaVersion: 1, baseRevision: baseRev, revision: rev,
              removedCells: [], changedCellsJson: [], changedCellIndices: [],
              removedModules: [], changedModulesJson: [], changedModuleIndices: [],
              linesJson: [line1Raw, line2Raw],
            },
          },
        }))
        return
      }
      if (cmd.type === 'edit.rail.place') {
        railSaves.push({ station: currentStation, lineId: cmd.payload.lineId })
      }
    }

    const player = {
      SendMessage(_obj, _method, json) {
        const cmd = JSON.parse(json)
        sent.push(cmd)
        if (sync) process(cmd)
        else pendingAsync.push(cmd)
      },
    }
    const flushOneAsync = () => {
      const cmd = pendingAsync.shift()
      assert.ok(cmd, 'expected pending async command')
      process(cmd)
    }
    return { player, sent, lineCounts, railSaves, pendingAsync, flushOneAsync, getRev: () => rev, getEpoch: () => epoch }
  }

  // 1a & 1b. Open A, Open B, New Line for B before registration — both sync and async transports.
  for (const sync of [true, false]) {
    stationBridge.unregister()
    const h = createShellHarness()
    const host = createMockHost({ sync })
    const openA = stationBridge.send('station.open', { document: docA, sourceId: 'A' })
    const openB = stationBridge.send('station.open', { document: docB, sourceId: 'B' })
    const addForB = h.sendAddLine('up')

    stationBridge.register(host.player)
    if (!sync) {
      assert.deepEqual(host.sent.map(c => c.id), [openA], 'async drain must hold at most one active queued load')
      host.flushOneAsync() // Open A commits & adopts -> Open B dispatches
      assert.deepEqual(host.sent.map(c => c.id), [openA, openB], 'Open B dispatches only after Open A adopts; addForB still waits')
      host.flushOneAsync() // Open B commits & adopts -> addForB dispatches
      assert.deepEqual(host.sent.map(c => c.id), [openA, openB, addForB], 'addForB dispatches only after Open B adopts')
      host.flushOneAsync() // addForB commits
    }

    assert.deepEqual(host.sent.map(c => c.id), [openA, openB, addForB])
    assert.equal(host.sent[2].expectedRevision, 2, 'dependent add must apply revision guard against Station B')
    assert.equal(h.dispatchedIntents[0]?.stationEpoch, 2, 'dependent add must bind to Station B epoch')
    assert.equal(h.cancelled.length, 0)
    assert.equal(host.lineCounts.get('A'), 1, `sync=${sync}: Station A must stay at 1 line`)
    assert.equal(host.lineCounts.get('B'), 2, `sync=${sync}: Station B must get exactly one add`)
    assert.equal(h.storeState.railLineId, '2', `sync=${sync}: Line 2 must become active on Station B`)
    assert.equal(h.sentTools.at(-1)?.settings?.lineId, '2', `sync=${sync}: rail tool must target Line 2`)
    stationBridge.send('edit.rail.place', { lineId: h.storeState.railLineId })
    if (!sync) host.flushOneAsync()
    assert.deepEqual(host.railSaves, [{ station: 'B', lineId: '2' }])
    h.dispose()
    stationBridge.unregister()
  }

  // 2. Edit for EACH load ([Open A, New Line A, Open B, New Line B]) — sync and async.
  for (const sync of [true, false]) {
    stationBridge.unregister()
    const h = createShellHarness()
    const host = createMockHost({ sync })
    const openA = stationBridge.send('station.open', { document: docA, sourceId: 'A' })
    const addA = h.sendAddLine('up')
    const openB = stationBridge.send('station.open', { document: docB, sourceId: 'B' })
    const addB = h.sendAddLine('up')

    stationBridge.register(host.player)
    if (!sync) {
      assert.deepEqual(host.sent.map(c => c.id), [openA])
      host.flushOneAsync() // Open A -> addA + Open B dispatch in order
      assert.deepEqual(host.sent.map(c => c.id), [openA, addA, openB])
      host.flushOneAsync() // addA commits on A (rev 2, epoch 1)
      assert.equal(host.lineCounts.get('A'), 2)
      host.flushOneAsync() // Open B commits & adopts (rev 3, epoch 2) -> addB dispatches
      assert.deepEqual(host.sent.map(c => c.id), [openA, addA, openB, addB])
      host.flushOneAsync() // addB commits on B (rev 4, epoch 2)
    }

    assert.deepEqual(host.sent.map(c => c.id), [openA, addA, openB, addB])
    assert.equal(host.sent[1].expectedRevision, 1)
    assert.equal(host.sent[3].expectedRevision, 3)
    assert.equal(host.lineCounts.get('A'), 2)
    assert.equal(host.lineCounts.get('B'), 2)
    assert.equal(h.storeState.railLineId, '2')
    assert.equal(h.cancelled.length, 0)
    h.dispose()
    stationBridge.unregister()
  }

  // 3. Rejected first load cancels ONLY its own dependent edit; second valid load and its edit succeed.
  for (const sync of [true, false]) {
    stationBridge.unregister()
    const h = createShellHarness()
    const openBadA = stationBridge.send('station.open', { document: docA, sourceId: 'A' })
    const addForA = h.sendAddLine('up')
    const openB = stationBridge.send('station.open', { document: docB, sourceId: 'B' })
    const addForB = h.sendAddLine('up')
    const host = createMockHost({ sync, failLoadId: openBadA })

    stationBridge.register(host.player)
    if (!sync) {
      assert.deepEqual(host.sent.map(c => c.id), [openBadA])
      host.flushOneAsync() // openBadA rejects -> cancels addForA only, dispatches openB
      assert.deepEqual(host.sent.map(c => c.id), [openBadA, openB])
      host.flushOneAsync() // openB commits & adopts -> dispatches addForB
      assert.deepEqual(host.sent.map(c => c.id), [openBadA, openB, addForB])
      host.flushOneAsync() // addForB commits
    }

    assert.deepEqual(h.cancelled, [{ id: addForA, reason: 'load-rejected' }])
    assert.deepEqual(host.sent.map(c => c.id), [openBadA, openB, addForB])
    assert.equal(host.lineCounts.get('B'), 2)
    assert.equal(h.storeState.railLineId, '2')
    h.dispose()
    stationBridge.unregister()
  }

  // 4. Stale-revision protection preserved for edits authored against an already loaded document,
  //    while edits queued behind an active load rebind expectedRevision to the target station.
  stationBridge.unregister()
  const guardH = createShellHarness()
  const guardHost = createMockHost({ sync: false })
  stationBridge.register(guardHost.player)
  const loadedA = stationBridge.send('station.open', { document: docA, sourceId: 'A' })
  guardHost.flushOneAsync() // A at rev 1, epoch 1
  // Edit authored against already-loaded A with stale expectedRevision=0 -> sent verbatim and rejected!
  const staleAdd = guardH.sendAddLine('up', 0)
  assert.equal(guardHost.sent.at(-1)?.id, staleAdd)
  assert.equal(guardHost.sent.at(-1)?.expectedRevision, 0, 'stale expectedRevision on already loaded doc must be preserved')
  guardHost.flushOneAsync() // rejected by host with revision-mismatch
  assert.equal(stationBridge.getSnapshot().rejects.at(-1)?.code, 'revision-mismatch')
  assert.equal(guardH.storeState.railLineId, '1')

  // Now queue Open B while A is at rev 1, and queue New Line passing A's rev 1 -> must rebind to B's rev 2!
  const openB2 = stationBridge.send('station.open', { document: docB, sourceId: 'B' })
  const addForB2 = guardH.sendAddLine('up', 1)
  guardHost.flushOneAsync() // Open B commits at rev 2, epoch 2 -> addForB2 dispatches with expectedRevision=2
  assert.equal(guardHost.sent.at(-1)?.id, addForB2)
  assert.equal(guardHost.sent.at(-1)?.expectedRevision, 2, 'dependent edit must rebind revision guard to Station B')
  guardHost.flushOneAsync()
  assert.equal(guardH.storeState.railLineId, '2')

  // 5. Disconnect & reconnect discards retired session reservations and fences out late replies.
  const oldSession = stationBridge.getSnapshot().sessionId
  const pendingBeforeReconnect = stationBridge.send('station.open', { document: docA, sourceId: 'A' })
  const queuedBeforeReconnect = guardH.sendAddLine('up')
  const host2 = createMockHost({ sync: false })
  stationBridge.register(host2.player)
  const newSession = stationBridge.getSnapshot().sessionId
  assert.notEqual(newSession, oldSession)
  assert.equal(guardH.cancelled.some(c => c.id === queuedBeforeReconnect && c.reason === 'session-changed'), true)
  assert.equal(host2.sent.length, 0)
  // Late reply from retired session is dropped cleanly.
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: pendingBeforeReconnect, sessionId: oldSession,
    revision: 99, accepted: true, payload: { stationEpoch: 9, sourceId: 'A', document: docA },
  }))
  assert.equal(stationBridge.getSnapshot().revision, -1)
  guardH.dispose()
  stationBridge.unregister()
})

test('plan 42 §2: dependent edits release only after matching shell adoption, failed adoption cancels only that load and advances, and stale/mismatched/duplicate replies do not release', () => {
  const validDocA = JSON.stringify({
    format: 'metro-save', formatVersion: 1, name: 'Valid A', city: 'guangzhou', seed: 1,
    levelBase: 0, storeyHeight: 5,
    static: { cells: [], modules: [], lines: [{ id: '1', name: '1号线', colour: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }] },
  })
  const validDocB = JSON.stringify({
    format: 'metro-save', formatVersion: 1, name: 'Valid B', city: 'shanghai', seed: 2,
    levelBase: 0, storeyHeight: 5,
    static: { cells: [], modules: [], lines: [{ id: '1', name: '1号线', colour: '#e4002b', stock: 'A', cars: 6, direction: 'up' }] },
  })

  // 1. Host commit WITHOUT shell adoption releases ZERO edits; mismatched adoptions & duplicate commits leave queue unchanged; matching adoption releases once.
  stationBridge.unregister()
  const sent = []
  const cancelled = []
  const loadA = stationBridge.send('station.open', { document: validDocA, sourceId: 'A' })
  const editA = stationBridge.send('edit.line.add', { direction: 'up' }, {
    onCancel: (id, reason) => cancelled.push({ id, reason }),
  })
  const loadB = stationBridge.send('station.open', { document: validDocB, sourceId: 'B' })
  const editB = stationBridge.send('edit.line.add', { direction: 'up' }, {
    onCancel: (id, reason) => cancelled.push({ id, reason }),
  })

  stationBridge.register({
    SendMessage(_obj, _method, json) { sent.push(JSON.parse(json)) },
  })
  const session = stationBridge.getSnapshot().sessionId
  assert.deepEqual(sent.map(c => c.id), [loadA])

  // Premature adoption before host commit does nothing.
  stationBridge.noteAdopted(1, 0, { commandId: loadA, sessionId: session, stationEpoch: 1 })
  assert.deepEqual(sent.map(c => c.id), [loadA])

  // Host commits loadA, but NO shell adoption listener calls noteAdopted -> ZERO dependent edits released!
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: loadA, sessionId: session, revision: 1, accepted: true,
    payload: { stationEpoch: 1, sourceId: 'A', document: validDocA },
  }))
  assert.deepEqual(sent.map(c => c.id), [loadA], 'host commit without shell adoption must release zero edits')

  // Duplicate commit reply & stale session reply leave queue unchanged.
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: loadA, sessionId: session, revision: 1, accepted: true,
    payload: { stationEpoch: 1, sourceId: 'A', document: validDocA },
  }))
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: loadA, sessionId: 's-stale', revision: 1, accepted: true,
    payload: { stationEpoch: 1, sourceId: 'A', document: validDocA },
  }))
  assert.deepEqual(sent.map(c => c.id), [loadA])

  // Mismatched adoptions (wrong commandId / sessionId / stationEpoch / revision / omitted target) cannot release.
  stationBridge.noteAdopted(1, 0)
  stationBridge.noteAdopted(1, 0, { commandId: loadB, sessionId: session, stationEpoch: 1 })
  stationBridge.noteAdopted(1, 0, { commandId: loadA, sessionId: 's-wrong', stationEpoch: 1 })
  stationBridge.noteAdopted(1, 0, { commandId: loadA, sessionId: session, stationEpoch: 99 })
  stationBridge.noteAdopted(2, 0, { commandId: loadA, sessionId: session, stationEpoch: 1 })
  assert.deepEqual(sent.map(c => c.id), [loadA], 'mismatched adoption must not release dependents')

  // Matching adoption releases editA (and then advances to loadB) exactly once!
  stationBridge.noteAdopted(1, 0, { commandId: loadA, sessionId: session, stationEpoch: 1 })
  assert.deepEqual(sent.map(c => c.id), [loadA, editA, loadB])
  // Calling noteAdopted a second time is idempotent and cannot re-dispatch editA or release editB.
  stationBridge.noteAdopted(1, 0, { commandId: loadA, sessionId: session, stationEpoch: 1 })
  assert.deepEqual(sent.map(c => c.id), [loadA, editA, loadB])
  assert.equal(sent.filter(c => c.id === editA).length, 1)

  // Commit + adopt loadB releases editB exactly once.
  stationBridge.receive(JSON.stringify({
    schemaVersion: 2, kind: 'commit', id: loadB, sessionId: session, revision: 2, accepted: true,
    payload: { stationEpoch: 2, sourceId: 'B', document: validDocB },
  }))
  assert.deepEqual(sent.map(c => c.id), [loadA, editA, loadB])
  stationBridge.noteAdopted(2, 0, { commandId: loadB, sessionId: session, stationEpoch: 2 })
  assert.deepEqual(sent.map(c => c.id), [loadA, editA, loadB, editB])
  assert.equal(cancelled.length, 0)
  stationBridge.unregister()

  // 2. Unreadable envelope triggers noteAdoptionFailed -> cancels ONLY that load's dependents, clears line reservations, and lets next valid load + its edit proceed.
  const tracker = createLineSelectionTracker()
  const sent2 = []
  const cancelled2 = []
  const corruptLoad = stationBridge.send('station.open', { document: '{bad-json', sourceId: 'corrupt' })
  let corruptQueued = false
  const editForCorrupt = stationBridge.send('edit.line.add', { direction: 'up' }, {
    beforeSend: ({ id, queued }) => { corruptQueued = queued; if (queued) tracker.reserveAdd(id) },
    beforeDispatch: ({ id, sessionId, stationEpoch }) => {
      if (corruptQueued) tracker.bindAdd(id, sessionId, stationEpoch)
      else tracker.trackAdd(id, sessionId, stationEpoch)
    },
    onCancel: (id, reason) => { cancelled2.push({ id, reason }); tracker.noteReject(id) },
  })
  const goodLoad = stationBridge.send('station.open', { document: validDocB, sourceId: 'B' })
  let goodQueued = false
  const editForGood = stationBridge.send('edit.line.add', { direction: 'up' }, {
    beforeSend: ({ id, queued }) => { goodQueued = queued; if (queued) tracker.reserveAdd(id) },
    beforeDispatch: ({ id, sessionId, stationEpoch }) => {
      if (goodQueued) tracker.bindAdd(id, sessionId, stationEpoch)
      else tracker.trackAdd(id, sessionId, stationEpoch)
    },
    onCancel: (id, reason) => { cancelled2.push({ id, reason }); tracker.noteReject(id) },
  })

  let adoptedCount = 0
  const stopAdopt = stationBridge.onCommit(snap => {
    if (typeof snap.document === 'string' && snap.documentRevision === snap.revision) {
      let parsed = null
      try { parsed = JSON.parse(snap.document) } catch { parsed = null }
      if (!parsed) {
        stationBridge.noteAdoptionFailed({
          commandId: snap.lastCommitId ?? '',
          sessionId: snap.sessionId,
          stationEpoch: snap.stationEpoch,
          revision: snap.revision,
        }, 'invalid-document')
        return
      }
      adoptedCount += 1
      stationBridge.noteAdopted(snap.revision, 0, {
        commandId: snap.lastCommitId ?? '',
        sessionId: snap.sessionId,
        stationEpoch: snap.stationEpoch,
      })
    }
  })

  // Synchronous WebGL player that replies immediately inside SendMessage (tests reentrancy safety!).
  stationBridge.register({
    SendMessage(_obj, _method, json) {
      const cmd = JSON.parse(json)
      sent2.push(cmd)
      if (cmd.id === corruptLoad) {
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId, revision: 1, accepted: true,
          payload: { stationEpoch: 1, sourceId: 'corrupt', document: '{bad-json' },
        }))
      } else if (cmd.id === goodLoad) {
        stationBridge.receive(JSON.stringify({
          schemaVersion: 2, kind: 'commit', id: cmd.id, sessionId: cmd.sessionId, revision: 2, accepted: true,
          payload: { stationEpoch: 2, sourceId: 'B', document: validDocB },
        }))
      }
    },
  })

  assert.deepEqual(cancelled2, [{ id: editForCorrupt, reason: 'invalid-document' }],
    'unreadable envelope must cancel only its own dependent edit')
  assert.deepEqual(sent2.map(c => c.id), [corruptLoad, goodLoad, editForGood],
    'reentrant sync drain must advance to valid load and dispatch editForGood exactly once')
  assert.equal(adoptedCount, 1)

  // Verify editForCorrupt's line reservation was cleared while editForGood's was bound to goodLoad's epoch (2).
  const goodSession = stationBridge.getSnapshot().sessionId
  const line1 = { id: '1', name: '1号线', color: '#e4002b', stock: 'A', cars: 6, direction: 'up' }
  const line2 = { id: '2', name: '2号线', color: '#00629b', stock: 'A', cars: 6, direction: 'up' }
  assert.equal(tracker.reconcile({
    sessionId: goodSession, stationEpoch: 2, commitId: editForCorrupt, createdLineId: '2',
    lines: [line1, line2], currentRailLineId: '1',
  }).createdLine, null, 'cancelled corrupt-load add reservation must be cleared')
  assert.equal(tracker.reconcile({
    sessionId: goodSession, stationEpoch: 2, commitId: editForGood, createdLineId: '2',
    lines: [line1, line2], currentRailLineId: '1',
  }).nextRailLineId, '2', 'valid load dependent edit must remain bound and select Line 2')

  stopAdopt()
  stationBridge.unregister()
})

test('plan 39 §5: line selection adopts host-created line, pushes rail target through toolAdapter, and reconciles on remove/undo/redo/reject/replacement', () => {
  const tracker = createLineSelectionTracker()
  const line1 = { id: '1', name: '1号线', color: '#f3d03e', stock: 'A', cars: 6, direction: 'up' }
  const line2 = { id: '2', name: '2号线', color: '#00629b', stock: 'A', cars: 6, direction: 'up' }

  const storeState = {
    tool: 'rail',
    railLineId: '1',
    railDir: 'up',
    railWidth: 3,
    railRot: 0,
    railElevation: 0,
    moduleType: 'bench',
    moduleRot: 0,
    paintFinish: 'floor.concrete',
    paintMode: 'single',
    zoneBrush: 'unpaid',
    facilityRot: 0,
    curtainHeight: 4,
    roadWidth: 6,
    roadDirection: 'two-way',
    stairStyle: 'straight',
    stairWidth: 2,
    stairRise: 5,
    stairRun: 10,
    escalatorWidth: 1,
    escalatorDir: 'up',
    walkwayWidth: 1,
    walkwayDir: 'forward',
    liftSize: 2,
    psdType: 'full',
  }
  const listeners = new Set()
  const sentTools = []
  const adapter = createToolAdapter({
    read: () => storeState,
    send: (tool, settings) => { sentTools.push({ tool, settings }) },
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    applyHostTool: () => {},
  })
  const setRailLine = (nextId) => {
    storeState.railLineId = nextId
    listeners.forEach(fn => fn())
  }

  // 1. Add line 2 -> correlated commit selects '2' and toolAdapter sends updated lineId='2'.
  tracker.trackAdd('c-add-2', 's-1', 1)
  const addRes = tracker.reconcile({
    sessionId: 's-1',
    stationEpoch: 1,
    commitId: 'c-add-2',
    createdLineId: '2',
    lines: [line1, line2],
    currentRailLineId: storeState.railLineId,
  })
  assert.equal(addRes.nextRailLineId, '2')
  assert.equal(addRes.createdLine?.id, '2')
  setRailLine(addRes.nextRailLineId)
  assert.equal(sentTools.at(-1)?.settings?.lineId, '2', 'rail tool target must update to newly created line')

  // 2. Remove selected line 2 -> falls back to remaining line 1 and pushes tool.set.
  const rmRes = tracker.reconcile({
    sessionId: 's-1',
    stationEpoch: 1,
    commitId: 'c-rm-2',
    createdLineId: null,
    lines: [line1],
    currentRailLineId: storeState.railLineId,
  })
  assert.equal(rmRes.nextRailLineId, '1')
  assert.equal(rmRes.changed, true)
  setRailLine(rmRes.nextRailLineId)
  assert.equal(sentTools.at(-1)?.settings?.lineId, '1')

  // 3. Remove last remaining line -> clears selection to ''.
  const emptyRes = tracker.reconcile({
    sessionId: 's-1',
    stationEpoch: 1,
    commitId: 'c-rm-1',
    createdLineId: null,
    lines: [],
    currentRailLineId: storeState.railLineId,
  })
  assert.equal(emptyRes.nextRailLineId, '')
  setRailLine(emptyRes.nextRailLineId)

  // 4. Undo restores line 1 -> reconciles from '' back to '1'.
  const undoRes = tracker.reconcile({
    sessionId: 's-1',
    stationEpoch: 1,
    commitId: 'c-undo',
    createdLineId: null,
    lines: [line1],
    currentRailLineId: storeState.railLineId,
  })
  assert.equal(undoRes.nextRailLineId, '1')
  setRailLine(undoRes.nextRailLineId)

  // 5. Refused stale add request leaves selected line unchanged.
  tracker.trackAdd('c-stale-add', 's-1', 1)
  tracker.noteReject('c-stale-add')
  const afterReject = tracker.reconcile({
    sessionId: 's-1',
    stationEpoch: 1,
    commitId: 'c-stale-add',
    createdLineId: '2',
    lines: [line1, line2],
    currentRailLineId: storeState.railLineId,
  })
  assert.equal(afterReject.nextRailLineId, '1', 'refused add must never select line 2')
  assert.equal(afterReject.createdLine, null)

  // 6. Pending add from an earlier session/epoch is cleared on station replacement.
  tracker.trackAdd('c-old-session', 's-1', 1)
  const afterReplace = tracker.reconcile({
    sessionId: 's-2',
    stationEpoch: 2,
    commitId: 'c-old-session',
    createdLineId: '2',
    lines: [line1, line2],
    currentRailLineId: '99',
  })
  assert.equal(afterReplace.createdLine, null, 'stale add from prior session must be ignored')
  assert.equal(afterReplace.nextRailLineId, '1', 'station replacement reconciles invalid railLineId to first line')
  adapter.dispose()
})

test('plan 39 §6: carriedMoveAdapter reflects valid/invalid targets, localizes refusal codes, memoizes cleanly, and clears on cancel/drop/replacement', () => {
  let currentSnap = makeSnapshot({ state: { edit: { carried: '', plan: null, moveReason: '' } } })
  let lang = 'en'
  const subs = new Set()
  const adapter = createCarriedMoveAdapter({
    getSnapshot: () => currentSnap,
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
    ownsStation: () => true,
    getLanguage: () => lang,
  })
  let notifications = 0
  const unsub = adapter.subscribeCarriedMove(() => { notifications++ })

  assert.equal(adapter.getCarriedMove(), null)

  // Start move and aim at an invalid occupied cell -> Confirm disabled, localized reason shown.
  currentSnap = makeSnapshot({
    state: {
      edit: {
        carried: 'bench-1',
        moveReason: 'occupied',
        plan: { ok: false, move: true, reason: 'occupied', cell: [4, 2, -5], candidate: { id: 'bench-1', x: 4, y: 2, z: -5 } },
      },
    },
  })
  subs.forEach(fn => fn())
  const blocked = adapter.getCarriedMove()
  assert.ok(blocked)
  assert.equal(blocked.moduleId, 'bench-1')
  assert.deepEqual(blocked.at, { x: 4, y: 2, z: -5 })
  assert.equal(blocked.canDrop, false)
  assert.equal(blocked.reason, noticeText({ kind: 'blocked', code: 'occupied', tool: 'move' }, 'en'))
  assert.equal(notifications, 1)

  // Unrelated state tick does not fire subscriber or change object identity.
  currentSnap = makeSnapshot({
    state: { ...currentSnap.state, clock: { simTime: 123 } },
  })
  subs.forEach(fn => fn())
  assert.equal(adapter.getCarriedMove(), blocked)
  assert.equal(notifications, 1)

  // Aim at valid cell -> Confirm enabled, empty reason.
  currentSnap = makeSnapshot({
    state: {
      edit: {
        carried: 'bench-1',
        moveReason: '',
        plan: { ok: true, move: true, reason: '', cell: [6, 2, -5], candidate: { id: 'bench-1', x: 6, y: 2, z: -5 } },
      },
    },
  })
  subs.forEach(fn => fn())
  const valid = adapter.getCarriedMove()
  assert.deepEqual(valid, { moduleId: 'bench-1', at: { x: 6, y: 2, z: -5 }, canDrop: true, reason: '' })
  assert.equal(notifications, 2)

  // Cancel or completed drop clears carried state.
  currentSnap = makeSnapshot({
    state: { edit: { carried: '', moveReason: '', plan: null } },
  })
  subs.forEach(fn => fn())
  assert.equal(adapter.getCarriedMove(), null)
  assert.equal(notifications, 3)

  // Non-owning host always yields null.
  assert.equal(readHostCarriedMove(makeSnapshot({
    state: { edit: { carried: 'bench-1', plan: { ok: true, move: true, candidate: { x: 1, y: 1, z: 0 } } } },
  }), false, 'zh-CN'), null)

  unsub()

  // Static contract: InfoCard consumes host carried move and routes Confirm/Cancel through store verbs.
  const infoCardSource = readFileSync(resolve(root, 'game/src/app/windows/inspector/InfoCard.tsx'), 'utf8')
  assert.match(infoCardSource, /getCarriedMove/)
  assert.match(infoCardSource, /subscribeCarriedMove/)
  assert.match(infoCardSource, /confirmMove\(\)/)
  assert.match(infoCardSource, /cancelMove\(\)/)
})

test('plan 39 sign-off: Windows WebView2 overlay allowlists both Chinese and English feedback links (/stats/report & /stats/en/report)', () => {
  const programCs = readFileSync(resolve(root, 'tools/unity-editor-ui/Program.cs'), 'utf8')
  assert.match(programCs, /NewWindowRequested\s*\+=\s*OnNewWindowRequested/)
  assert.match(programCs, /e\.Handled\s*=\s*true/)
  assert.match(programCs, /TryResolveAllowedExternalUrl/)
  assert.match(programCs, /"\/stats\/report"/)
  assert.match(programCs, /"\/stats\/en\/report"/)
  assert.match(programCs, /https:\/\/stationdesigner\.com/)
  assert.match(programCs, /https:\/\/app\.metro\.local/)
  assert.match(programCs, /UseShellExecute\s*=\s*true/)
})
