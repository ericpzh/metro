import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { attachExplodedInput, parseExplodedHostState } from '../../game/src/unity-web/explodedInput.ts'
import { clampExplodedFloorPanelPosition } from '../../game/src/app/windows/explodedPanelBounds.ts'
import { attachCanvasCameraGestures, attachViewStateBridge } from '../../game/src/unity-web/cameraAdapter.ts'
import { useStore } from '../../game/src/app/store.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

class FakeTarget {
  constructor() {
    this.listeners = new Map()
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(handler)
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type)
    if (!list) return
    const idx = list.indexOf(handler)
    if (idx >= 0) list.splice(idx, 1)
  }
  dispatch(type, event) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event)
  }
}

class FakeCanvas extends FakeTarget {
  constructor(width = 1280, height = 720) {
    super()
    this.width = width
    this.height = height
    this.clientWidth = width
    this.clientHeight = height
    this.captured = new Set()
  }
  getBoundingClientRect() {
    return { left: 10, top: 20, width: this.width, height: this.height, right: 10 + this.width, bottom: 20 + this.height }
  }
  setPointerCapture(id) { this.captured.add(id) }
  hasPointerCapture(id) { return this.captured.has(id) }
  releasePointerCapture(id) {
    this.captured.delete(id)
    this.dispatch('lostpointercapture', { pointerId: id, stopPropagation() {} })
  }
}

function makeFrames() {
  const queue = []
  return {
    requestFrame(cb) { queue.push(cb); return queue.length },
    cancelFrame(id) { if (id > 0) queue[id - 1] = null },
    flush() {
      while (queue.length) {
        const cb = queue.shift()
        if (cb) cb()
      }
    },
  }
}

test('parseExplodedHostState normalizes rows, panel anchor and generation fencing', () => {
  assert.equal(parseExplodedHostState(null), null)
  assert.equal(parseExplodedHostState([]), null)

  const parsed = parseExplodedHostState({
    generation: 4,
    sourceRevision: 9,
    phase: 'ready',
    equipped: true,
    selectedElevation: -15,
    dragging: true,
    rows: [
      { elevation: -20, floorVisible: true, wallsVisible: true, packedOffset: 0, manualOffset: [0, 0, 0] },
      { elevation: -15, floorVisible: true, wallsVisible: false, packedOffset: 24, manualOffset: [6.5, 0, -3.25] },
    ],
    panelAnchor: [0.62, 0.48],
    activeGuides: 22,
  })
  assert.ok(parsed)
  assert.equal(parsed.generation, 4)
  assert.equal(parsed.sourceRevision, 9)
  assert.equal(parsed.phase, 'ready')
  assert.equal(parsed.equipped, true)
  assert.equal(parsed.selectedElevation, -15)
  assert.equal(parsed.dragging, true)
  assert.equal(parsed.rows.length, 2)
  assert.deepEqual(parsed.rows[1], {
    elevation: -15,
    floorVisible: true,
    wallsVisible: false,
    packedOffset: 24,
    manualOffset: [6.5, 0, -3.25],
  })
  assert.deepEqual(parsed.panelAnchor, [0.62, 0.48])
  assert.equal(parsed.activeGuides, 22)
})

test('clampExplodedFloorPanelPosition keeps floating floor controls inside usable viewport bounds', () => {
  const bounds = { left: 0, top: 56, width: 1280, height: 620 }
  assert.deepEqual(clampExplodedFloorPanelPosition([-200, -100], 180, 76, bounds), { left: 8, top: 64 })
  assert.deepEqual(clampExplodedFloorPanelPosition([2000, 2000], 180, 76, bounds), { left: 1092, top: 592 })
  assert.deepEqual(clampExplodedFloorPanelPosition([400, 300], 180, 76, bounds), { left: 412, top: 262 })
})

test('attachExplodedInput coalesces left-drag moves, flushes before release, and routes camera gestures', () => {
  const canvas = new FakeCanvas(1000, 500)
  const win = new FakeTarget()
  const doc = Object.assign(new FakeTarget(), { visibilityState: 'visible' })
  const frames = makeFrames()
  const sent = []
  let generation = 3
  let ready = true
  let draggingTray = false
  let closed = 0
  let toggledPlay = 0

  const ctrl = attachExplodedInput(
    canvas,
    { send: (type, payload) => sent.push({ type, payload }) },
    {
      getGeneration: () => generation,
      isReady: () => ready,
      isDraggingTray: () => draggingTray,
      onClose: () => { closed += 1 },
      onTogglePlay: () => { toggledPlay += 1 },
    },
    frames,
    { win, doc },
  )

  try {
    // Left press sends exactly one exploded.pointerDown in canvas-local CSS pixels
    canvas.dispatch('pointerdown', {
      button: 0, pointerId: 11, clientX: 210, clientY: 170,
      preventDefault() {}, stopPropagation() {},
    })
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0], {
      type: 'exploded.pointerDown',
      payload: { generation: 3, pointerId: 11, x: 200, y: 150, viewportWidth: 1000, viewportHeight: 500 },
    })

    // Multiple pointermove events coalesce to one rAF move and flush before pointerup
    canvas.dispatch('pointermove', { pointerId: 11, clientX: 230, clientY: 165, preventDefault() {}, stopPropagation() {} })
    canvas.dispatch('pointermove', { pointerId: 11, clientX: 260, clientY: 150, preventDefault() {}, stopPropagation() {} })
    assert.equal(sent.length, 1, 'moves stay queued until rAF or release')
    canvas.dispatch('pointerup', { pointerId: 11, clientX: 260, clientY: 150, stopPropagation() {} })
    assert.deepEqual(sent.slice(1), [
      {
        type: 'exploded.pointerMove',
        payload: { generation: 3, pointerId: 11, dx: 50, dy: -20, viewportWidth: 1000, viewportHeight: 500 },
      },
      {
        type: 'exploded.pointerUp',
        payload: { generation: 3, pointerId: 11 },
      },
    ])

    // Window-captured pointermove/pointerup still continues an active canvas drag when
    // a sibling overlay (.explodedFloorPanel) mounts under the pointer, without double-applying
    // the same event object if both win and canvas see it.
    sent.length = 0
    canvas.dispatch('pointerdown', {
      button: 0, pointerId: 14, clientX: 300, clientY: 200,
      preventDefault() {}, stopPropagation() {},
    })
    const sharedMoveEvt = { pointerId: 14, buttons: 1, clientX: 335, clientY: 185, preventDefault() {}, stopPropagation() {} }
    win.dispatch('pointermove', sharedMoveEvt)
    canvas.dispatch('pointermove', sharedMoveEvt)
    canvas.dispatch('lostpointercapture', { pointerId: 14, buttons: 1 })
    const sharedUpEvt = { pointerId: 14, buttons: 0, clientX: 335, clientY: 185, preventDefault() {}, stopPropagation() {} }
    win.dispatch('pointerup', sharedUpEvt)
    canvas.dispatch('pointerup', sharedUpEvt)
    assert.deepEqual(sent, [
      {
        type: 'exploded.pointerDown',
        payload: { generation: 3, pointerId: 14, x: 290, y: 180, viewportWidth: 1000, viewportHeight: 500 },
      },
      {
        type: 'exploded.pointerMove',
        payload: { generation: 3, pointerId: 14, dx: 35, dy: -15, viewportWidth: 1000, viewportHeight: 500 },
      },
      {
        type: 'exploded.pointerUp',
        payload: { generation: 3, pointerId: 14 },
      },
    ])

    // Middle drag orbits and right drag pans
    sent.length = 0
    canvas.dispatch('pointerdown', { button: 1, pointerId: 12, clientX: 400, clientY: 300, preventDefault() {}, stopPropagation() {} })
    canvas.dispatch('pointermove', { pointerId: 12, clientX: 440, clientY: 280, preventDefault() {}, stopPropagation() {} })
    frames.flush()
    canvas.dispatch('pointerup', { pointerId: 12, stopPropagation() {} })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, 'exploded.camera')
    assert.equal(sent[0].payload.op, 'orbit')
    assert.equal(sent[0].payload.dx, 40)
    assert.equal(sent[0].payload.dy, -20)

    sent.length = 0
    canvas.dispatch('pointerdown', { button: 2, pointerId: 13, clientX: 400, clientY: 300, preventDefault() {}, stopPropagation() {} })
    canvas.dispatch('pointermove', { pointerId: 13, clientX: 370, clientY: 330, preventDefault() {}, stopPropagation() {} })
    frames.flush()
    canvas.dispatch('pointerup', { pointerId: 13, stopPropagation() {} })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].payload.op, 'pan')
    assert.equal(sent[0].payload.dx, -30)
    assert.equal(sent[0].payload.dy, 30)

    // Wheel zooms
    sent.length = 0
    canvas.dispatch('wheel', { deltaY: -120, preventDefault() {}, stopPropagation() {} })
    assert.deepEqual(sent, [{
      type: 'exploded.camera',
      payload: { generation: 3, op: 'zoom', deltaY: -120, viewportWidth: 1000, viewportHeight: 500 },
    }])

    // WASD + Shift sends held planar camera intent, suppressed while dragging a tray, and cleared on blur
    sent.length = 0
    let stoppedImmediate = 0
    const keyEvt = (type, key, code = key, extra = {}) => ({
      type, key, code, repeat: false, altKey: false, ctrlKey: false, metaKey: false, target: null,
      preventDefault() {},
      stopImmediatePropagation() { stoppedImmediate += 1 },
      ...extra,
    })
    win.dispatch('keydown', keyEvt('keydown', 'w', 'KeyW'))
    win.dispatch('keydown', keyEvt('keydown', 'Shift', 'ShiftLeft'))
    assert.ok(stoppedImmediate >= 2, 'modal capture listener stops editor shortcut propagation')
    assert.deepEqual(sent, [
      { type: 'exploded.camera', payload: { generation: 3, op: 'panPlanarHeld', right: 0, forward: 1, boost: false } },
      { type: 'exploded.camera', payload: { generation: 3, op: 'panPlanarHeld', right: 0, forward: 1, boost: true } },
    ])

    sent.length = 0
    win.dispatch('blur', {})
    assert.deepEqual(sent, [
      { type: 'exploded.camera', payload: { generation: 3, op: 'panPlanarHeld', right: 0, forward: 0, boost: false } },
    ])

    // While dragging a tray, WASD does not drift the camera
    sent.length = 0
    draggingTray = true
    win.dispatch('keydown', keyEvt('keydown', 'd', 'KeyD'))
    assert.equal(sent.length, 0)
    draggingTray = false

    // Space toggles play/pause unless focused inside .explodedFloorPanel or .explodedLevels button
    win.dispatch('keydown', keyEvt('keydown', ' ', 'Space'))
    assert.equal(toggledPlay, 1)
    win.dispatch('keydown', keyEvt('keydown', ' ', 'Space', {
      target: { closest: selector => selector.includes('explodedFloorPanel') ? {} : null },
    }))
    assert.equal(toggledPlay, 1, 'focused floor panel button keeps native Space activation')

    // Escape closes the modal and clears held keys
    win.dispatch('keydown', keyEvt('keydown', 'Escape', 'Escape'))
    assert.equal(closed, 1)
  } finally {
    ctrl.dispose()
  }
})

test('editor camera gestures block while explodedView is open and attachViewStateBridge respects forwardExploded: false', () => {
  const canvas = new FakeCanvas(800, 600)
  const sent = []
  const port = {
    getSnapshot: () => ({ target: [0, 0, 0], distance: 100, yaw: 0, pitch: 0.7, ortho: false, fovScale: 1, right: [1, 0, 0], up: [0, 0, 1], back: [0, -1, 0] }),
    subscribe: () => () => {},
    send: command => sent.push(command),
    dispose: () => {},
  }

  let blocked = true
  const detachGestures = attachCanvasCameraGestures(canvas, port, { blocked: () => blocked })
  const detachView = attachViewStateBridge(port, { forwardExploded: false })
  try {
    sent.length = 0
    canvas.dispatch('wheel', { deltaY: 100, preventDefault() {} })
    assert.equal(sent.length, 0, 'editor wheel listener yields while blocked')
    blocked = false
    canvas.dispatch('wheel', { deltaY: 100, preventDefault() {} })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, 'camera.zoom')

    sent.length = 0
    useStore.setState({ explodedView: true })
    assert.equal(sent.some(cmd => cmd.type === 'view.set' && cmd.payload?.key === 'exploded'), false, 'UnityExplodedView owns exploded open/close')
  } finally {
    useStore.setState({ explodedView: false })
    detachView()
    detachGestures()
  }
})

test('Plan 19 C#/shader/oracle assets carry .meta files, overlay CSS keeps ready modal transparent, and dist-unity-ui excludes Three', () => {
  const requiredAssets = [
    'unity/Assets/StationDesigner/Runtime/App/StationExplodedView.cs',
    'unity/Assets/StationDesigner/Runtime/App/Views/StationExplodedTrayBuilder.cs',
    'unity/Assets/StationDesigner/Runtime/View/StationExplodedLayoutPlan.cs',
    'unity/Assets/StationDesigner/Runtime/View/StationExplodedConnections.cs',
    'unity/Assets/StationDesigner/Resources/StationExplodedGuide.shader',
    'unity/Assets/StationDesigner/Tests/EditMode/StationExplodedLayoutTests.cs',
    'unity/Assets/StationDesigner/Tests/EditMode/StationExplodedConnectionTests.cs',
    'unity/Assets/StationDesigner/Tests/EditMode/station-exploded-view-oracle.json',
  ]
  for (const rel of requiredAssets) {
    const abs = path.join(repoRoot, rel)
    assert.equal(existsSync(abs), true, `${rel} must exist`)
    assert.equal(existsSync(`${abs}.meta`), true, `${rel}.meta must exist`)
  }

  const tagManager = readFileSync(path.join(repoRoot, 'unity/ProjectSettings/TagManager.asset'), 'utf8')
  assert.match(tagManager, /ExplodedPresentation/, 'User Layer 8 must be named ExplodedPresentation')

  const hostProgram = readFileSync(path.join(repoRoot, 'tools/unity-editor-ui/Program.cs'), 'utf8')
  assert.match(hostProgram, /html\.metro-overlay \.explodedViewer\[data-ready="true"\]/)
  assert.match(hostProgram, /html\.metro-overlay \.explodedViewer::backdrop/)
  assert.match(hostProgram, /html\.metro-overlay body:has\(\.explodedViewer\[open\]\) \.app/)

  const distAssetsDir = path.join(repoRoot, 'game/dist-unity-ui/assets')
  if (existsSync(distAssetsDir)) {
    for (const file of readdirSync(distAssetsDir)) {
      if (!file.endsWith('.js')) continue
      const js = readFileSync(path.join(distAssetsDir, file), 'utf8')
      assert.doesNotMatch(js, /WebGLRenderer|SceneRenderer/, `${file} in dist-unity-ui must not bundle Three SceneRenderer`)
    }
  }
})
