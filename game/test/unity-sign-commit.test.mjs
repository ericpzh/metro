// Plan 11 F3: the 指示牌 editor's ✓ across the Unity bridge.
//
// In the Unity player the committed document belongs to C#, so `SignSlice`'s
// commit action must send one `sign.commit` (carrying the revision it was
// composed against) instead of writing the store. In the Three/TS app no host is
// registered, so the same action keeps the original store path — the point of
// these cases is that the adapter cannot silently steal an edit from the app.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  commitSignBoardsToHost,
  signCommitComponent,
  signCommitPayload,
  unityHostOwnsStation,
} from '../src/unity-web/signCommitAdapter.ts'
import { stationBridge } from '../src/unity-web/stationBridge.ts'
import { useStore } from '../src/app/store.ts'
import { createModule, toState } from '../src/build/model.ts'
import { settleSignBoards } from '../src/sim/sign.ts'

const LINE = {
  id: '5', name: '5号线', nameEn: 'Line 5', colour: '#c70541',
  stock: 'L', cars: 6, power: 'third-rail', psd: 'full', direction: 'up',
  upTerminus: '', downTerminus: '',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
}

const ARROW = { id: 'c1', kind: 'arrow', arrow: 'down-left', x: 0.3, y: 0.2, scale: 1, side: 'both' }
const TEXT = { id: 'c2', kind: 'text', text: '文冲方向\nTowards Wenchong', x: 0.8, y: 0.2, scale: 1, side: 'both' }
const BADGE = { id: 'c3', kind: 'line', lineId: '5', english: true, x: 1.2, y: 0.2, scale: 1, side: 'both' }
const ICON = { id: 'c4', kind: 'icon', icon: 'lift', x: 1.4, y: 0.2, scale: 1, side: 'both' }

function recorder(snapshot) {
  const sent = []
  return {
    sent,
    getSnapshot: () => snapshot,
    send(type, payload, options) { sent.push({ type, payload, options }); return 'c-test' },
  }
}

const READY = {
  ready: true, sessionId: 's-1', revision: 7, documentRevision: 7,
  document: '{"format":"metro-save"}', sourceId: 'zoo', sourceHash: 'abc',
  state: {}, capabilities: {}, rejects: [],
}

test('a component crosses the bridge with the fields the source editor writes', () => {
  assert.deepEqual(signCommitComponent(ARROW), {
    id: 'c1', x: 0.3, y: 0.2, scale: 1, side: 'both', kind: 'arrow', arrow: 'down-left',
  })
  assert.deepEqual(signCommitComponent(TEXT), {
    id: 'c2', x: 0.8, y: 0.2, scale: 1, side: 'both', kind: 'text', text: '文冲方向\nTowards Wenchong',
  })
  assert.deepEqual(signCommitComponent(BADGE), {
    id: 'c3', x: 1.2, y: 0.2, scale: 1, side: 'both', kind: 'line', lineId: '5', english: true,
  })
  assert.deepEqual(signCommitComponent(ICON), {
    id: 'c4', x: 1.4, y: 0.2, scale: 1, side: 'both', kind: 'icon', icon: 'lift',
  })
})

test('both faces travel in one command, in paint order', () => {
  const boards = settleSignBoards({ front: [ARROW, TEXT, BADGE], back: [ICON] })
  const payload = signCommitPayload('sign-309', boards)
  assert.equal(payload.signId, 'sign-309')
  assert.equal(payload.faces.front.length, 3)
  assert.equal(payload.faces.back.length, 1)
  assert.deepEqual(payload.faces.front.map((component) => component.id), boards.front.map((component) => component.id))
  assert.equal(payload.faces.front[1].text, '文冲方向\nTowards Wenchong', 'CJK + English survives verbatim')
  assert.equal(payload.faces.front[2].lineId, '5', 'the line badge keeps its line')
  assert.equal(payload.faces.back[0].icon, 'lift')
  assert.equal(boards.front[1].side, 'both', 'a face-owned board stores side both')
})

test('no committed host means no command and no host-owned edit', () => {
  // The real bridge is EMPTY until a Unity player registers and commits.
  assert.equal(unityHostOwnsStation(), false)
  assert.equal(commitSignBoardsToHost('sign-1', { front: [ARROW], back: [] }), false)

  const unready = recorder({ ...READY, ready: false })
  assert.equal(commitSignBoardsToHost('sign-1', { front: [ARROW], back: [] }, unready), false)
  assert.equal(unready.sent.length, 0)

  const noDocument = recorder({ ...READY, document: null })
  assert.equal(commitSignBoardsToHost('sign-1', { front: [ARROW], back: [] }, noDocument), false)
  assert.equal(noDocument.sent.length, 0)

  // A commit whose document has not been adopted yet is not a station to edit.
  const behind = recorder({ ...READY, documentRevision: 6 })
  assert.equal(commitSignBoardsToHost('sign-1', { front: [ARROW], back: [] }, behind), false)
  assert.equal(behind.sent.length, 0)
})

test('a host-owned edit is one sign.commit at the committed revision', () => {
  const port = recorder(READY)
  const boards = { front: [ARROW, TEXT, BADGE], back: [] }
  assert.equal(commitSignBoardsToHost('sign-309', boards, port), true)
  assert.equal(port.sent.length, 1, 'one command, so at most one revision')
  const command = port.sent[0]
  assert.equal(command.type, 'sign.commit')
  assert.equal(command.options.expectedRevision, 7, 'the command carries the revision it was composed against')
  assert.equal(command.payload.signId, 'sign-309')
  assert.equal(command.payload.faces.front.length, 3)
  assert.deepEqual(command.payload.faces.back, [], 'an empty back is a real board, not an omission')
})

test('without a Unity host the store keeps its own commit path', () => {
  const built = createModule('sign-wall', 2, 3, 0, 'sign-w', 0, undefined, 'up', 'right', [LINE])
  const state = toState({
    name: 'sign commit test',
    seed: 1,
    cells: [{ x: 2, y: 3, z: 0, fill: 'solid' }],
    modules: [built],
    lines: [LINE],
  })
  const boards = { front: state.modules[0].cfg.front, back: [] }
  useStore.setState({ station: state, currentBoards: boards, past: [], future: [], signEditorFor: null })
  useStore.getState().openSignEditor('sign-w')
  const longer = settleSignBoards({ front: [...boards.front, ARROW], back: [] })
  useStore.getState().commitSignLayout(longer)
  useStore.getState().closeSignEditor()
  const module = useStore.getState().station.modules.find((m) => m.id === 'sign-w')
  assert.deepEqual(module.cfg.front, longer.front, 'the TypeScript app still writes the module')
  assert.equal(module.cfg.mount, 'wall', 'and keeps the piece’s own mount')
  assert.equal(stationBridge.getSnapshot().ready, false, 'no player was registered by importing the adapter')
})
