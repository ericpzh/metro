// Unity artwork providers (`psdHeaderProvider`, `signFaceProvider`), sign/host verb bridges
// (`signCommitAdapter`, `stationHostBridge`), touch-zoom + pointer arbitration (`cameraAdapter`,
// `pointerInput`), camera home/frame & view-state forwarding, split-asset failure handling,
// and shell/settings Unity wiring contracts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stubCanvas } from '../../game/test/support/stub-canvas.mjs'
import {
  PSD_HEADER_DEFAULT_COLOUR,
  PSD_HEADER_PANEL_HEIGHT,
  createPsdHeaderPort,
  isPsdHeaderRequest,
  paintPsdHeader,
  psdHeaderColour,
} from '../../game/src/unity-web/psdHeaderProvider.ts'
import {
  createSignFacePort,
  isSignRequest,
  paintSignFace,
  setSignFaceArt,
  signFaceLocale,
} from '../../game/src/unity-web/signFaceProvider.ts'
import {
  commitSignBoardsToHost,
  signCommitPayload,
  unityHostOwnsStation,
} from '../../game/src/unity-web/signCommitAdapter.ts'
import {
  canEditStationName,
  hostOwnsVerb,
  registerStationHostCommit,
  stationHostCommit,
} from '../../game/src/app/stationHostBridge.ts'
import {
  attachCanvasCameraGestures,
  attachViewStateBridge,
  cameraCommands,
  createStationCameraPort,
} from '../../game/src/unity-web/cameraAdapter.ts'
import { attachCanvasToolPointer } from '../../game/src/unity-web/pointerInput.ts'
import { pictograms } from '../../game/src/render/signFace.ts'
import { getLanguage, setLanguage } from '../../game/src/sim/i18n.ts'
import { PX_PER_METRE, signPlate } from '../../game/src/sim/sign.ts'
import { useStore } from '../../game/src/app/store.ts'
import localWorker from '../../tools/unity-web/local-worker.mjs'

const repo = resolve(import.meta.dirname, '../..')

function surfaceFactory(options = {}) {
  const created = []
  const factory = (width, height) => {
    const stub = stubCanvas(width, height)
    const transforms = []
    stub.g.translate = (x, y) => { transforms.push({ op: 'translate', x, y }) }
    const png = typeof options.png === 'function' ? options.png(created.length) : (options.png ?? 'ZmFrZQ==')
    const record = {
      width,
      height,
      transforms,
      get words() { return stub.ops.words },
      get texts() { return stub.ops.texts },
      get drawn() { return stub.ops.drawn },
    }
    const surface = {
      width,
      height,
      context: stub.g,
      pngBase64: () => png,
    }
    created.push({ surface, record })
    return surface
  }
  return { factory, created }
}

/* ----------------------------------------------------------- PSD header provider */

const PSD_PANEL = {
  key: 'psd|5|up|station',
  moduleId: 'psd-1',
  kind: 'station',
  pixels: 1024,
  width: 2.0,
  height: 0.5,
  lineId: '5',
  colour: '#c70541',
  direction: 'up',
  stationName: '动物园',
  stationNameEn: 'Zoo',
  destination: '文冲',
  destinationEn: 'Wenchong',
  arrow: 1,
}

function psdRequest(panels, options = {}) {
  return JSON.stringify({
    schemaVersion: 2,
    kind: 'psdHeaderRequest',
    type: 'psd.requestHeader',
    id: options.id ?? 'psd-req-1',
    sessionId: options.sessionId ?? 's-1',
    revision: options.revision ?? 3,
    payload: { requestId: options.id ?? 'psd-req-1', panels },
  })
}

test('paintPsdHeader paints 1024 px panels and 2048 px paired half-height stickers with colour fallback', () => {
  assert.equal(psdHeaderColour('#c70541'), '#c70541')
  assert.equal(psdHeaderColour('#abc'), '#abc')
  assert.equal(psdHeaderColour('not-a-hex'), PSD_HEADER_DEFAULT_COLOUR)

  const single = surfaceFactory()
  const station = paintPsdHeader(PSD_PANEL, { createSurface: single.factory })
  assert.equal(station.width, 1024)
  assert.equal(station.height, PSD_HEADER_PANEL_HEIGHT)
  assert.ok(single.created[0].record.texts.includes('动物园'))
  assert.ok(single.created[0].record.texts.includes('文冲'))

  const paired = surfaceFactory()
  const sticker = paintPsdHeader(
    { ...PSD_PANEL, key: 'psd|5|up|sticker', kind: 'sticker', pixels: 2048 },
    { createSurface: paired.factory },
  )
  assert.equal(sticker.width, 2048, 'paired half-height sticker uses 2048 px width')
  assert.equal(sticker.height, PSD_HEADER_PANEL_HEIGHT)
  assert.deepEqual(
    paired.created[0].record.transforms,
    [{ op: 'translate', x: 1024, y: 0 }],
    'sticker draws route on the left 1024 px and translates +1024 px for the station right half',
  )
  assert.ok(paired.created[0].record.texts.includes('动物园'))
  assert.ok(paired.created[0].record.texts.includes('文冲'))
})

test('createPsdHeaderPort chunks PNGs, deduplicates keys, reports font pending, and ignores unrelated messages', async () => {
  const sent = []
  const png = 'P'.repeat(2500)
  const factory = surfaceFactory({ png })
  const port = createPsdHeaderPort({
    send: (type, payload) => { sent.push({ type, payload }); return '' },
    createSurface: factory.factory,
    ensureFonts: async () => true,
    chunkSize: 1024,
  })
  try {
    assert.equal(isPsdHeaderRequest(psdRequest([PSD_PANEL])), true)
    assert.equal(port.receive(JSON.stringify({ schemaVersion: 2, kind: 'signRequest', payload: {} })), false)
    assert.equal(port.receive('{'), false)
    assert.equal(port.receive(null), false)

    // Two identical panel keys deduplicate to one paint and one chunk sequence.
    assert.equal(port.receive(psdRequest([PSD_PANEL, { ...PSD_PANEL }])), true)
    await port.whenIdle()
    const chunks = sent.filter(m => m.type === 'psd.headerChunk')
    const ready = sent.filter(m => m.type === 'psd.headerReady')
    assert.equal(factory.created.length, 1, 'duplicate keys are painted once')
    assert.equal(chunks.length, 3, '2500 base64 chars split into three 1024-char chunks')
    assert.equal(chunks.map(c => c.payload.data).join(''), png, 'chunks reassemble verbatim')
    assert.equal(chunks[0].payload.count, 3)
    assert.equal(chunks[0].payload.requestId, 'psd-req-1')
    assert.equal(ready.length, 1)
    assert.equal(ready[0].payload.artReady, true)
    assert.equal(ready[0].payload.painted.length, 1)
    assert.deepEqual(ready[0].payload.pending, [])
  } finally {
    port.dispose()
  }

  // Font pending retry emits zero chunks and marks artReady: false.
  const fontSent = []
  const fontFactory = surfaceFactory()
  const fontPort = createPsdHeaderPort({
    send: (type, payload) => { fontSent.push({ type, payload }); return '' },
    createSurface: fontFactory.factory,
    ensureFonts: async () => false,
  })
  try {
    fontPort.receive(psdRequest([PSD_PANEL], { id: 'psd-font-wait' }))
    await fontPort.whenIdle()
    assert.equal(fontSent.filter(m => m.type === 'psd.headerChunk').length, 0)
    const ready = fontSent.find(m => m.type === 'psd.headerReady')
    assert.equal(ready.payload.artReady, false)
    assert.deepEqual(ready.payload.pending.map(p => p.reason), ['font'])
    assert.equal(fontFactory.created.length, 0)
  } finally {
    fontPort.dispose()
  }
})

/* ------------------------------------------------------------ sign face provider */

const SIGN_LINES = [{ id: '5', name: '5号线', colour: '#c70541' }]
const SIGN_BOARD = {
  key: 'sign|309|front',
  moduleId: 'sign-309',
  face: 'front',
  panel: { w: 2.0, h: 0.4 },
  components: [
    { id: 'c1', kind: 'arrow', arrow: 'right', x: 0.3, y: 0.2, scale: 1, side: 'both' },
    { id: 'c2', kind: 'text', text: '出口\nExit', x: 1.0, y: 0.2, scale: 1, side: 'both' },
  ],
  lines: SIGN_LINES,
  defaultLineId: '5',
}

function signRequest(faces, options = {}) {
  return JSON.stringify({
    schemaVersion: 2,
    kind: 'signRequest',
    type: 'sign.requestFace',
    id: options.id ?? 'sign-req-1',
    sessionId: options.sessionId ?? 's-1',
    revision: options.revision ?? 9,
    payload: { requestId: options.id ?? 'sign-req-1', locale: options.locale, faces },
  })
}

test('paintSignFace normalizes locale, swaps and restores shell language, and paints at plate pixels', () => {
  assert.equal(signFaceLocale('en'), 'en')
  assert.equal(signFaceLocale('zh'), 'zh-CN')
  assert.equal(signFaceLocale('zh_CN'), 'zh-CN')
  assert.equal(signFaceLocale('unknown', 'en'), 'en')

  const previousLang = getLanguage()
  try {
    setLanguage('zh-CN')
    const factory = surfaceFactory({ png: 'U0lHTg==' })
    const painted = paintSignFace({ ...SIGN_BOARD, locale: 'en' }, { createSurface: factory.factory })
    assert.equal(getLanguage(), 'zh-CN', 'temporary painter locale swap always restores the shell language')
    const expected = signPlate(SIGN_BOARD.panel)
    assert.equal(painted.width, expected.width)
    assert.equal(painted.height, expected.height)
    assert.equal(expected.width, Math.round(SIGN_BOARD.panel.w * PX_PER_METRE))
    assert.equal(painted.pngBase64, 'U0lHTg==')

    // Even if drawing throws, the shell locale is restored in finally.
    assert.throws(() => paintSignFace({ ...SIGN_BOARD, locale: 'en' }, {
      createSurface: () => ({
        width: 100,
        height: 100,
        context: { setTransform() { throw new Error('boom') } },
        pngBase64: () => 'AAAA',
      }),
    }), /boom/)
    assert.equal(getLanguage(), 'zh-CN', 'locale restores even when painter throws')
  } finally {
    setLanguage(previousLang)
  }
})

test('createSignFacePort chunks faces, retries pending fonts/pictograms, and ignores unrelated messages', async () => {
  const previousArt = new Map(pictograms())
  try {
    // 1. Chunked success + unrelated message guard.
    const sent = []
    const png = 'S'.repeat(2600)
    const port = createSignFacePort({
      send: (type, payload) => { sent.push({ type, payload }); return '' },
      createSurface: surfaceFactory({ png }).factory,
      ensureFonts: async () => true,
      ensurePictograms: async () => true,
      chunkSize: 1024,
    })
    try {
      assert.equal(isSignRequest(signRequest([SIGN_BOARD])), true)
      assert.equal(port.receive(JSON.stringify({ schemaVersion: 2, kind: 'psdHeaderRequest', payload: {} })), false)
      assert.equal(port.receive('{'), false)
      assert.equal(port.receive(null), false)

      assert.equal(port.receive(signRequest([SIGN_BOARD])), true)
      await port.whenIdle()
      const chunks = sent.filter(m => m.type === 'sign.faceChunk')
      const ready = sent.filter(m => m.type === 'sign.faceReady')
      assert.equal(chunks.length, 3)
      assert.equal(chunks.map(c => c.payload.data).join(''), png)
      assert.equal(ready.length, 1)
      assert.equal(ready[0].payload.artReady, true)
      assert.equal(ready[0].payload.painted.length, 1)
    } finally {
      port.dispose()
    }

    // 2. Font pending retry.
    const fontSent = []
    const fontPort = createSignFacePort({
      send: (type, payload) => { fontSent.push({ type, payload }); return '' },
      createSurface: surfaceFactory().factory,
      ensureFonts: async () => false,
    })
    try {
      fontPort.receive(signRequest([SIGN_BOARD], { id: 'sign-font-wait' }))
      await fontPort.whenIdle()
      assert.equal(fontSent.filter(m => m.type === 'sign.faceChunk').length, 0)
      const ready = fontSent.find(m => m.type === 'sign.faceReady')
      assert.equal(ready.payload.artReady, false)
      assert.deepEqual(ready.payload.pending.map(p => p.reason), ['font'])
    } finally {
      fontPort.dispose()
    }

    // 3. Missing bitmap pictogram reports pending `reason: 'pictogram'`, then succeeds once art lands.
    setSignFaceArt(new Map())
    const iconBoard = {
      ...SIGN_BOARD,
      key: 'sign|310|front',
      components: [{ id: 'i1', kind: 'icon', icon: 'lift', x: 0.5, y: 0.2, scale: 1, side: 'both' }],
    }
    const picSent = []
    const picPort = createSignFacePort({
      send: (type, payload) => { picSent.push({ type, payload }); return '' },
      createSurface: surfaceFactory().factory,
      ensureFonts: async () => true,
      ensurePictograms: async () => false,
    })
    try {
      picPort.receive(signRequest([iconBoard], { id: 'sign-pic-wait' }))
      await picPort.whenIdle()
      assert.equal(picSent.filter(m => m.type === 'sign.faceChunk').length, 0)
      const pendingReady = picSent.find(m => m.type === 'sign.faceReady')
      assert.equal(pendingReady.payload.artReady, false)
      assert.equal(pendingReady.payload.pending[0].reason, 'pictogram')
      assert.equal(pendingReady.payload.pending[0].detail, 'lift')

      setSignFaceArt(new Map([['lift', { icon: 'lift', width: 128, height: 128 }]]))
      picPort.receive(signRequest([iconBoard], { id: 'sign-pic-ready' }))
      await picPort.whenIdle()
      const doneReady = picSent.filter(m => m.type === 'sign.faceReady').at(-1)
      assert.equal(doneReady.payload.artReady, true)
      assert.equal(doneReady.payload.painted.length, 1)
    } finally {
      picPort.dispose()
    }
  } finally {
    setSignFaceArt(previousArt)
  }
})

/* ------------------------------------------- signCommitAdapter & stationHostBridge */

test('signCommitAdapter supports both full-document and delta-adopted Unity snapshots', () => {
  const boards = {
    front: [
      { id: 'c1', kind: 'arrow', arrow: 'left', x: 0.2, y: 0.2, scale: 1, side: 'both' },
      { id: 'c2', kind: 'line', lineId: '5', english: false, x: 0.6, y: 0.2, scale: 1, side: 'both' },
    ],
    back: [
      { id: 'b1', kind: 'text', text: '出站', x: 0.4, y: 0.2, scale: 1, side: 'both' },
      { id: 'b2', kind: 'icon', icon: 'lift', x: 0.8, y: 0.2, scale: 1, side: 'both' },
    ],
  }
  const payload = signCommitPayload('sign-42', boards, 'en')
  assert.equal(payload.signId, 'sign-42')
  assert.equal(payload.locale, 'en')
  assert.equal(payload.faces.front.length, 2)
  assert.equal(payload.faces.back.length, 2)

  const sent = []
  const makePort = snapshot => ({
    getSnapshot: () => snapshot,
    send(type, body, options) { sent.push({ type, body, options }); return 'c-1' },
  })

  const deltaOwned = makePort({
    ready: true, sessionId: 's-1', revision: 12, document: null, documentRevision: 10,
    adoptedRevision: 12, resyncNeeded: false, sourceId: 'zoo', sourceHash: null, state: {}, capabilities: {}, rejects: [],
  })
  assert.equal(unityHostOwnsStation(deltaOwned), true)
  assert.equal(commitSignBoardsToHost('sign-42', boards, deltaOwned), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'sign.commit')
  assert.equal(sent[0].options.expectedRevision, 12)

  const resyncing = makePort({
    ready: true, sessionId: 's-1', revision: 12, document: '{}', documentRevision: 12,
    resyncNeeded: true, sourceId: 'zoo', sourceHash: null, state: {}, capabilities: {}, rejects: [],
  })
  assert.equal(unityHostOwnsStation(resyncing), false)
  assert.equal(commitSignBoardsToHost('sign-42', boards, resyncing), false)
})

test('stationHostBridge dispatches all 7 hostOwnsVerb verbs and commitExit when host owns station', () => {
  const verbs = [
    'undo',
    'redo',
    'deleteSelection',
    'cancelGesture',
    'rotateCarried',
    'cycleCarriedLightPosition',
    'confirmMove',
  ]
  const calls = []
  let owns = false
  const refused = new Set()
  const port = {
    ownsStation: () => owns,
    commitSignBoards: () => true,
    commitExit: (moduleId, patch) => { calls.push({ verb: 'commitExit', moduleId, patch }); return true },
  }
  for (const verb of verbs) {
    port[verb] = () => {
      calls.push({ verb })
      return !refused.has(verb)
    }
  }

  try {
    registerStationHostCommit(null)
    for (const verb of verbs) assert.equal(hostOwnsVerb(verb), false, `${verb} is false without host`)

    registerStationHostCommit(port)
    for (const verb of verbs) assert.equal(hostOwnsVerb(verb), false, `${verb} is false when ownsStation() is false`)
    assert.equal(calls.length, 0)

    owns = true
    for (const verb of verbs) assert.equal(hostOwnsVerb(verb), true, `${verb} claimed by owning host`)
    assert.deepEqual(calls.map(c => c.verb), verbs)

    refused.add('rotateCarried')
    assert.equal(hostOwnsVerb('rotateCarried'), false, 'refused verb falls back cleanly')
    assert.equal(hostOwnsVerb('confirmMove'), true, 'other verbs remain claimed')

    const committed = stationHostCommit()?.commitExit?.('exit-7', { name: 'D', inRate: 180, open: false })
    assert.equal(committed, true)
    assert.deepEqual(calls.at(-1), {
      verb: 'commitExit',
      moduleId: 'exit-7',
      patch: { name: 'D', inRate: 180, open: false },
    })
  } finally {
    registerStationHostCommit(null)
  }
})

/* ------------------------------------------- TouchZoom in cameraAdapter + pointerInput */

class FakeCanvas {
  constructor(width = 600, height = 400) {
    this.listeners = new Map()
    this.width = width
    this.height = height
    this.clientHeight = height
    this.captured = new Set()
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(handler)
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type)
    if (!list) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }
  dispatch(type, event) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event)
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height }
  }
  setPointerCapture(id) { this.captured.add(id) }
  hasPointerCapture(id) { return this.captured.has(id) }
  releasePointerCapture(id) { this.captured.delete(id) }
}

function touchEvent(pointerId, clientX, clientY, overrides = {}) {
  return {
    pointerId,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
    pointerType: 'touch',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
    ...overrides,
  }
}

test('TouchZoom in cameraAdapter and pointerInput zooms on pinch, suppresses pinch/3-finger/cancelled taps, and allows clean taps', () => {
  const canvas = new FakeCanvas()
  const camSent = []
  const toolSent = []
  const detachCamera = attachCanvasCameraGestures(canvas, { send: cmd => camSent.push(cmd) })
  const detachTool = attachCanvasToolPointer(canvas, { send: cmd => toolSent.push(cmd) })
  try {
    // 1. Two-finger spread & pinch dispatches camera.zoom { factor } and suppresses all tool edits.
    canvas.dispatch('pointerdown', touchEvent(1, 0, 0))
    canvas.dispatch('pointerdown', touchEvent(2, 100, 0))
    canvas.dispatch('pointermove', touchEvent(2, 200, 0))
    canvas.dispatch('pointermove', touchEvent(2, 100, 0))
    canvas.dispatch('pointerup', touchEvent(1, 0, 0, { buttons: 0 }))
    canvas.dispatch('pointermove', touchEvent(2, 90, 0))
    canvas.dispatch('pointerup', touchEvent(2, 90, 0, { buttons: 0 }))

    assert.deepEqual(camSent, [
      { type: 'camera.zoom', payload: { factor: 0.5 } },
      { type: 'camera.zoom', payload: { factor: 2 } },
    ], 'spread zooms in (0.5) and pinch zooms out (2)')
    assert.deepEqual(toolSent, [], 'neither finger release of a pinch triggers a touch tap/edit')

    // 2. Coincident + 3-finger + cancelled touch ignores invalid zoom and suppresses tap.
    camSent.length = 0
    canvas.dispatch('pointerdown', touchEvent(10, 0, 0))
    canvas.dispatch('pointerdown', touchEvent(11, 0, 0))
    canvas.dispatch('pointermove', touchEvent(11, 100, 0))
    canvas.dispatch('pointerdown', touchEvent(12, 50, 50))
    canvas.dispatch('pointermove', touchEvent(12, 60, 50))
    canvas.dispatch('pointercancel', touchEvent(12, 60, 50, { buttons: 0 }))
    canvas.dispatch('pointermove', touchEvent(11, 200, 0))
    canvas.dispatch('pointerup', touchEvent(11, 200, 0, { buttons: 0 }))
    canvas.dispatch('pointerup', touchEvent(10, 0, 0, { buttons: 0 }))

    assert.deepEqual(camSent, [
      { type: 'camera.zoom', payload: { factor: 0.5 } },
    ], 'coincident and 3-finger moves produce no invalid zoom; valid 2-finger spread after cancel zooms')
    assert.deepEqual(toolSent, [], '3-finger/cancelled session triggers zero tool commands')

    // Cancelled single-finger touch must not tap.
    canvas.dispatch('pointerdown', touchEvent(13, 40, 40))
    canvas.dispatch('pointercancel', touchEvent(13, 40, 40, { buttons: 0 }))
    canvas.dispatch('pointerup', touchEvent(13, 40, 40, { buttons: 0 }))
    assert.deepEqual(toolSent, [], 'cancelled single touch triggers no tap')

    // 3. Subsequent single-finger tap routes normally to pointer.down + pointer.up.
    canvas.dispatch('pointerdown', touchEvent(20, 120, 90))
    assert.equal(toolSent.length, 0, 'touch down is deferred until release in case a second finger lands')
    canvas.dispatch('pointerup', touchEvent(20, 122, 91, { buttons: 0 }))
    // Browser fires lostpointercapture after release; must not poison the next tap.
    canvas.dispatch('lostpointercapture', touchEvent(20, 122, 91, { buttons: 0 }))
    assert.deepEqual(toolSent.map(c => c.type), ['pointer.down', 'pointer.up'])
    assert.equal(toolSent[0].payload.x, 122)
    assert.equal(toolSent[0].payload.y, 91)
    assert.equal(toolSent[0].payload.pointerType, 'touch')

    // Another clean tap right after lostpointercapture still works.
    toolSent.length = 0
    canvas.dispatch('pointerdown', touchEvent(21, 160, 110))
    canvas.dispatch('pointerup', touchEvent(21, 160, 110, { buttons: 0 }))
    assert.deepEqual(toolSent.map(c => c.type), ['pointer.down', 'pointer.up'])

    // Single-finger drag past 8 px tap threshold is suppressed.
    toolSent.length = 0
    canvas.dispatch('pointerdown', touchEvent(22, 10, 10))
    canvas.dispatch('pointermove', touchEvent(22, 50, 10))
    canvas.dispatch('pointerup', touchEvent(22, 50, 10, { buttons: 0 }))
    assert.deepEqual(toolSent, [])
  } finally {
    detachTool()
    detachCamera()
  }
})

/* ------------------------------------------- camera port window events & view state */

test('createStationCameraPort forwards metro:home and metro:frame until disposed, and attachViewStateBridge forwards hideUi & followPassenger', () => {
  assert.deepEqual(cameraCommands.zoomFactor(0.5), { type: 'camera.zoom', payload: { factor: 0.5 } })

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const sent = []
  const fakeBridge = {
    send(type, payload) { sent.push({ type, payload }); return 'c-1' },
    subscribe() { return () => {} },
    getSnapshot() { return { state: {} } },
    onCameraPose() { return () => {} },
  }
  const before = useStore.getState()
  const restoreHideUi = before.hideUI
  const restoreFollow = before.followAgentId

  globalThis.window = new EventTarget()
  const port = createStationCameraPort(fakeBridge)
  const viewCommands = []
  const detachView = attachViewStateBridge({
    send(command) { viewCommands.push(command) },
    subscribe() { return () => {} },
    dispose() {},
  })
  try {
    globalThis.window.dispatchEvent(new Event('metro:home'))
    globalThis.window.dispatchEvent(new Event('metro:frame'))
    assert.deepEqual(sent, [
      { type: 'camera.home', payload: {} },
      { type: 'camera.frame', payload: {} },
    ])

    port.dispose()
    globalThis.window.dispatchEvent(new Event('metro:home'))
    globalThis.window.dispatchEvent(new Event('metro:frame'))
    assert.equal(sent.length, 2, 'dispose() unsubscribes metro:home and metro:frame')

    useStore.getState().setHideUI(!restoreHideUi)
    useStore.setState({ followAgentId: 42 })
    useStore.setState({ followAgentId: null })
    assert.deepEqual(viewCommands, [
      { type: 'view.set', payload: { key: 'hideUi', value: !restoreHideUi } },
      { type: 'view.set', payload: { key: 'followPassenger', value: 42 } },
      { type: 'view.set', payload: { key: 'followPassenger', value: null } },
    ])
  } finally {
    detachView()
    port.dispose()
    useStore.getState().setHideUI(restoreHideUi)
    useStore.setState({ followAgentId: restoreFollow })
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
  }
})

/* --------------------------- split-asset failure handling + main/SettingsMenu wiring */

test('local-worker split asset loader reassembles parts and rejects missing or malformed chunks', async () => {
  const manifest = {
    splitFiles: {
      'Build/good.data': { parts: ['Build/good.data.part0', 'Build/good.data.part1'], bytes: 5 },
      'Build/missing-first.data': { parts: ['Build/missing-first.data.part0'], bytes: 3 },
      'Build/missing-second.data': { parts: ['Build/good.data.part0', 'Build/missing-second.data.part1'], bytes: 6 },
      'Build/bad-meta.data': { parts: [], bytes: -1 },
    },
  }
  const env = {
    ASSET_PREFIX: '/game/unity',
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname
        if (path === '/manifest.json') return Response.json(manifest)
        if (path === '/Build/good.data.part0') return new Response(new Uint8Array([10, 20, 30]), { status: 200 })
        if (path === '/Build/good.data.part1') return new Response(new Uint8Array([40, 50]), { status: 200 })
        return new Response('Not found', { status: 404 })
      },
    },
  }

  const ok = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/_unity/Build/good.data'), env)
  assert.equal(ok.status, 200)
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [10, 20, 30, 40, 50])

  const notFound = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/_unity/Build/unknown.data'), env)
  assert.equal(notFound.status, 404, 'unknown split asset returns 404')

  const missingFirst = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/_unity/Build/missing-first.data'), env)
  assert.equal(missingFirst.status, 502, 'missing first split part returns 502')

  const badMeta = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/_unity/Build/bad-meta.data'), env)
  assert.equal(badMeta.status, 502, 'invalid split metadata returns 502')

  const missingSecond = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/_unity/Build/missing-second.data'), env)
  assert.equal(missingSecond.status, 200)
  await assert.rejects(() => missingSecond.arrayBuffer(), /Missing split asset part/)
})

test('main.tsx and SettingsMenu.tsx preserve paintPick, passenger selection, curtain/psd-end/pillar eyedropper, and Unity graphics wiring', () => {
  const mainSource = readFileSync(join(repo, 'game/src/unity-web/main.tsx'), 'utf8')
  const pickSource = readFileSync(join(repo, 'game/src/app/tools/PickTool.ts'), 'utf8')
  const menuSource = readFileSync(join(repo, 'game/src/app/windows/topbar/SettingsMenu.tsx'), 'utf8')

  // Paint eyedropper (`paintPick`) sets finish and restores prior paint mode.
  assert.match(mainSource, /tools\.tool === 'paint' && tools\.paintMode === 'pick' && pickedFinish/)
  assert.match(mainSource, /tools\.setPaintFinish\(pickedFinish as never\)/)
  assert.match(mainSource, /tools\.resumePaintMode\(\)/)

  // Passenger selection (`kind === 'agent'`) routes to store selection with localized passenger label.
  assert.match(mainSource, /\(kind === 'module' \|\| kind === 'cell' \|\| kind === 'agent'\) && key/)
  assert.match(mainSource, /kind === 'agent' \? msg\('passenger_value', Number\(key\)\) : label/)

  // Eyedropper pick adoption delegates to shared PickTool.adoptPickedModule, restoring
  // curtainWidth/curtainHeight, psdEndHeight, pillarLength, and all other module settings.
  assert.match(mainSource, /adoptPickedModule\(picked,\s*\{\s*select:\s*false\s*\}\)/)
  assert.match(pickSource, /mod\.type === 'glass' && optionId === 'curtain-wall'/)
  assert.match(pickSource, /curtainWidth:\s*Math\.max\(1,\s*Math\.min\(4,\s*mod\.w\)\)/)
  assert.match(pickSource, /mod\.type === 'psd-end' && mod\.cfg\.variant !== 'cover'/)
  assert.match(pickSource, /psdEndHeight:\s*mod\.cfg\.psd/)
  assert.match(pickSource, /mod\.type === 'pillar'/)
  assert.match(pickSource, /pillarLength:\s*pillarSectionOf\(mod\.cfg\.height\)/)

  // SettingsMenu.tsx wires Unity host modelDetail, upscaling, and desktop openBenchmark.
  assert.match(menuSource, /const modelDetail = stationHost\?\.modelDetail/)
  assert.match(menuSource, /const hostUpscaling = stationHost\?\.upscaling/)
  assert.match(menuSource, /\{modelDetail \? menuOpen && <ModelDetailSetting readOrSet=\{modelDetail\}\/>/)
  assert.match(menuSource, /\{hostUpscaling \? menuOpen && <UpscalingSetting readOrSet=\{hostUpscaling\}\/>/)
  assert.match(menuSource, /stationHost\?\.openBenchmark/)
  assert.match(mainSource, /stationBridge\.request\('graphics\.get'\)/)
  assert.match(mainSource, /stationBridge\.request\('graphics\.set', \{ profile \}\)/)
  assert.match(mainSource, /stationBridge\.request\('graphics\.set', \{ upscaling: mode \}\)/)
})

test('Unity shell keeps TopBar station name editable when host exposes commitStationName alongside files', () => {
  const prevPort = stationHostCommit()
  const prevStation = useStore.getState().station
  try {
    // Plain Three.js app (no host, no files): editable.
    assert.equal(canEditStationName(false, false, null), true)
    // Legacy file-only zooUi (no host, files provided): read-only.
    assert.equal(canEditStationName(false, true, null), false)
    // Unity shell (host + files provided, commitStationName registered): editable.
    assert.equal(canEditStationName(true, true, { commitStationName: () => true }), true)
    assert.equal(canEditStationName(true, false, { commitStationName: () => true }), true)
    // Host without commitStationName: read-only.
    assert.equal(canEditStationName(true, true, {}), false)
    assert.equal(canEditStationName(true, true, null), false)

    // Store renameStation delegates to commitStationName when host owns the station.
    const committed = []
    registerStationHostCommit({
      ownsStation: () => true,
      commitSignBoards: () => false,
      commitStationName: (name, nameEn) => { committed.push({ name, nameEn }); return true },
      undo: () => false,
      redo: () => false,
      deleteSelection: () => false,
      cancelGesture: () => false,
    })
    assert.equal(canEditStationName(true, true), true)
    useStore.getState().renameStation('春熙路', 'Chunxi Rd')
    assert.deepEqual(committed, [{ name: '春熙路', nameEn: 'Chunxi Rd' }])

    // TopBar subscribes to host commit registration and delegates editable logic to canEditStationName.
    const topBarSource = readFileSync(join(repo, 'game/src/app/windows/topbar/TopBar.tsx'), 'utf8')
    const mainSource = readFileSync(join(repo, 'game/src/unity-web/main.tsx'), 'utf8')
    assert.match(topBarSource, /useSyncExternalStore\(\s*subscribeStationHostCommit,\s*stationHostCommit,\s*stationHostCommit/)
    assert.match(topBarSource, /canEditStationName\(Boolean\(host\), Boolean\(files\), hostCommit\)/)
    assert.doesNotMatch(topBarSource, /editable=\{!files &&/)
    assert.match(mainSource, /commitStationName:\s*\(name, nameEn\)\s*=>\s*sendRevisionedEdit\('edit\.rename', \{ name, nameEn \}\)/)
  } finally {
    registerStationHostCommit(prevPort)
    useStore.setState({ station: prevStation })
  }
})
