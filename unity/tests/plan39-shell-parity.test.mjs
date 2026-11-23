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

test('plan 39 §3/§5: stationBridge.send preserves queued command IDs across register() and reducer records lastCommitId & lastCommitLineId', () => {
  stationBridge.unregister()
  const queuedId = stationBridge.send('station.openDemo', { id: 'zoo' })
  assert.ok(queuedId.startsWith('c-'), 'queued startup send must mint and return a non-empty command ID')

  const sent = []
  stationBridge.register({
    SendMessage(_obj, _method, json) { sent.push(JSON.parse(json)) },
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].id, queuedId, 'flushed command must preserve its pre-register command ID')
  assert.equal(sent[0].type, 'station.openDemo')

  const base = makeSnapshot({ sessionId: 's-1', revision: 1 })
  const committed = reduce(base, {
    kind: 'commit',
    id: 'c-add-2',
    sessionId: 's-1',
    revision: 2,
    payload: {
      stationEpoch: 1,
      lineId: '2',
      delta: {
        schemaVersion: 1,
        baseRevision: 1,
        revision: 2,
        removedCells: [],
        changedCells: [],
        removedModules: [],
        changedModules: [],
        lines: [{ id: '1', name: '1号线' }, { id: '2', name: '2号线' }],
      },
    },
  })
  assert.equal(committed.lastCommitId, 'c-add-2')
  assert.equal(committed.lastCommitLineId, '2')
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
