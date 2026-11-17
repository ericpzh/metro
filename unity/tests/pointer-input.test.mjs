// Plan 16 §1.2 at the shell boundary: the React canvas forwards **one tool pointer
// command per event family**, coalesces a drag to at most one `pointer.move` per
// animation frame, and leaves camera gestures to `cameraAdapter.ts`. The C# router
// resolves one scene pick per command, so a flood of browser moves must never become a
// flood of picks — that is the invariant this file pins.
//
// A fake canvas and port stand in for the WebGL element and the v2 bridge; the
// production `attachCanvasToolPointer` is the code under test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachCanvasToolPointer } from '../../game/src/unity-web/pointerInput.ts'
import { attachCanvasCameraGestures } from '../../game/src/unity-web/cameraAdapter.ts'

class FakeCanvas {
  constructor(width = 600, height = 400) {
    this.listeners = new Map()
    this.width = width
    this.height = height
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

function pointerEvent(overrides = {}) {
  return {
    clientX: 100, clientY: 80, pointerId: 7, button: 0, buttons: 1, pointerType: 'mouse',
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    preventDefault() {},
    ...overrides,
  }
}

function installFrames() {
  const previous = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  const queue = []
  globalThis.requestAnimationFrame = callback => { queue.push(callback); return queue.length }
  globalThis.cancelAnimationFrame = id => { if (id > 0) queue[id - 1] = null }
  return {
    flush() {
      while (queue.length) {
        const callback = queue.shift()
        if (callback) callback()
      }
    },
    restore() {
      globalThis.requestAnimationFrame = previous.raf
      globalThis.cancelAnimationFrame = previous.caf
    },
  }
}

function setup() {
  const canvas = new FakeCanvas()
  const commands = []
  const port = { send: command => commands.push(command) }
  const frames = installFrames()
  const detach = attachCanvasToolPointer(canvas, port)
  return { canvas, commands, frames, detach }
}

test('a pointer press sends exactly one down with canvas-relative coordinates', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    canvas.dispatch('pointerdown', pointerEvent({ clientX: 120, clientY: 90 }))
    assert.equal(commands.length, 1)
    const [command] = commands
    assert.equal(command.type, 'pointer.down')
    assert.equal(command.payload.x, 120)
    assert.equal(command.payload.y, 90)
    assert.equal(command.payload.w, 600)
    assert.equal(command.payload.h, 400)
    assert.equal(command.payload.pointerId, 7)
    assert.equal(command.payload.button, 0)
    // The shell stamps the revision/generation it was aimed at, from the bridge snapshot.
    assert.equal(command.payload.documentRevision, -1)
    assert.equal(command.payload.toolGeneration, -1)
    // The client clock lets the host test the reference's press thresholds (160 ms, 4 px).
    assert.equal(typeof command.payload.time, 'number')
    assert.ok(command.payload.time >= 0)
  } finally {
    frames.restore()
    detach()
  }
})

test('a drag is coalesced to one move per animation frame', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    for (let step = 1; step <= 5; step++) {
      canvas.dispatch('pointermove', pointerEvent({ buttons: 1, clientX: 100 + step * 10 }))
    }
    assert.equal(commands.length, 0, 'nothing is sent before the frame')
    frames.flush()
    assert.equal(commands.length, 1, 'five browser moves become one pointer move')
    assert.equal(commands[0].type, 'pointer.move')
    assert.equal(commands[0].payload.x, 150, 'the latest position wins')
    for (let step = 1; step <= 3; step++) {
      canvas.dispatch('pointermove', pointerEvent({ buttons: 1, clientX: 200 + step }))
    }
    frames.flush()
    assert.equal(commands.length, 2)
    assert.equal(commands[1].payload.x, 203)
  } finally {
    frames.restore()
    detach()
  }
})

test('a release flushes the queued move before the up event', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    canvas.dispatch('pointerdown', pointerEvent())
    canvas.dispatch('pointermove', pointerEvent({ buttons: 1, clientX: 140 }))
    canvas.dispatch('pointerup', pointerEvent({ buttons: 0, clientX: 140 }))
    // Releasing the pointer capture fires `lostpointercapture`; it is not a cancel.
    canvas.dispatch('lostpointercapture', pointerEvent({ buttons: 0, clientX: 140 }))
    assert.deepEqual(commands.map(command => command.type), ['pointer.down', 'pointer.move', 'pointer.up'])
    assert.ok(!commands.some(command => command.type === 'pointer.cancel'), 'a normal release must not cancel a carried piece')
  } finally {
    frames.restore()
    detach()
  }
})

test('a right tap is a tool cancel but a right drag stays the camera pan', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2, clientX: 200, clientY: 200 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 0, clientX: 201, clientY: 202 }))
    assert.deepEqual(commands.map(command => command.type), ['pointer.rightTap'])
    commands.length = 0
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2, clientX: 200, clientY: 200 }))
    canvas.dispatch('pointermove', pointerEvent({ button: -1, buttons: 2, clientX: 260, clientY: 240 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 0, clientX: 260, clientY: 240 }))
    assert.ok(!commands.some(command => command.type === 'pointer.rightTap'), 'a pan is not a tool click')
  } finally {
    frames.restore()
    detach()
  }
})

test('a tool that claims the right button receives a right press, drag and release', () => {
  const canvas = new FakeCanvas()
  const commands = []
  const frames = installFrames()
  const detach = attachCanvasToolPointer(canvas, { send: command => commands.push(command) }, {
    claimsRight: () => true,
  })
  try {
    // The block brush digs with the secondary button: the press is the tool's, so the camera
    // adapter's pan must never see it (`cameraAdapter.attachCanvasCameraGestures` asks the
    // same predicate).
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2, clientX: 200, clientY: 200 }))
    canvas.dispatch('pointermove', pointerEvent({ button: -1, buttons: 2, clientX: 240, clientY: 210 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 0, clientX: 240, clientY: 210 }))
    assert.deepEqual(commands.map(command => command.type), ['pointer.down', 'pointer.move', 'pointer.up'])
    assert.equal(commands[0].payload.button, 2)
    assert.equal(commands[0].payload.buttons, 2)
    // A right drag is a tool gesture, never a tap.
    assert.ok(!commands.some(command => command.type === 'pointer.rightTap'))
    assert.equal(commands[2].payload.button, 2)
    assert.equal(canvas.hasPointerCapture(7), false, 'the release drops the capture')
  } finally {
    frames.restore()
    detach()
  }
})

test('a tool that does not claim the right button keeps the camera pan and a tap', () => {
  const canvas = new FakeCanvas()
  const commands = []
  const frames = installFrames()
  const detach = attachCanvasToolPointer(canvas, { send: command => commands.push(command) }, {
    claimsRight: () => false,
  })
  try {
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2, clientX: 200, clientY: 200 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 0, clientX: 201, clientY: 202 }))
    assert.deepEqual(commands.map(command => command.type), ['pointer.rightTap'])
  } finally {
    frames.restore()
    detach()
  }
})

test('a cancelled pointer clears the tool drag, and a leave clears only hover', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    canvas.dispatch('pointerleave', pointerEvent({ buttons: 0 }))
    assert.deepEqual(commands.map(command => command.type), ['pointer.leave'])
    commands.length = 0
    canvas.dispatch('pointerdown', pointerEvent())
    canvas.dispatch('pointercancel', pointerEvent({ buttons: 0 }))
    assert.deepEqual(commands.map(command => command.type), ['pointer.down', 'pointer.cancel'])
  } finally {
    frames.restore()
    detach()
  }
})

test('a blocked shell never starts a tool gesture', () => {
  const canvas = new FakeCanvas()
  const commands = []
  const frames = installFrames()
  const detach = attachCanvasToolPointer(canvas, { send: command => commands.push(command) }, { blocked: () => true })
  try {
    canvas.dispatch('pointerdown', pointerEvent())
    canvas.dispatch('pointermove', pointerEvent({ buttons: 1 }))
    frames.flush()
    assert.equal(commands.length, 0, 'a dialog or benchmark lock owns the pointer')
  } finally {
    frames.restore()
    detach()
  }
})

test('desktop/Editor metro-overlay maps docked stage clicks to full swapchain coordinates', () => {
  const canvas = new FakeCanvas(748, 630)
  canvas.getBoundingClientRect = () => ({ left: 232, top: 48, width: 748, height: 630, right: 980, bottom: 678 })
  canvas.ownerDocument = {
    documentElement: { classList: { contains: token => token === 'metro-overlay' } },
    defaultView: { innerWidth: 1280, innerHeight: 720 },
  }
  const commands = []
  const frames = installFrames()
  const detach = attachCanvasToolPointer(canvas, { send: command => commands.push(command) })
  try {
    canvas.dispatch('pointerdown', pointerEvent({ clientX: 640, clientY: 360 }))
    assert.equal(commands.length, 1)
    assert.equal(commands[0].payload.x, 640)
    assert.equal(commands[0].payload.y, 360)
    assert.equal(commands[0].payload.w, 1280)
    assert.equal(commands[0].payload.h, 720)
  } finally {
    frames.restore()
    detach()
  }
})

/* ------------------------------------------------------------------ plan 29 §2 chords */

const types = commands => commands.map(command => command.type)

function claimedSetup(claimsRight) {
  const canvas = new FakeCanvas()
  const commands = []
  const frames = installFrames()
  const detach = attachCanvasToolPointer(canvas, { send: command => commands.push(command) }, {
    claimsRight: () => claimsRight,
  })
  return { canvas, commands, frames, detach }
}

test('a second button press cancels the held gesture once and consumes both releases', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    canvas.dispatch('pointerdown', pointerEvent({ clientX: 100, clientY: 80, buttons: 1 }))
    canvas.dispatch('pointermove', pointerEvent({ buttons: 1, clientX: 120 }))
    // The browser reports the second button of the chord. The queued move is dropped with
    // the gesture, so no stray `pointer.move` aims the press that was just cancelled.
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 3 }))
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.cancel'])
    assert.equal(commands.length, 1 + 1, 'exactly one cancel, never a second down')
    assert.equal(canvas.hasPointerCapture(7), false, 'the chord drops the capture')
    // The release of the other button, then the owner's release: both are consumed so the
    // still-held button cannot commit the rectangle the player cancelled.
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 1 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 0, buttons: 0 }))
    frames.flush()
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.cancel'])
    // The next clean press is a normal gesture again.
    canvas.dispatch('pointerdown', pointerEvent({ buttons: 1 }))
    canvas.dispatch('pointerup', pointerEvent({ buttons: 0 }))
    assert.deepEqual(types(commands).slice(2), ['pointer.down', 'pointer.up'])
  } finally {
    frames.restore()
    detach()
  }
})

test('a chord is detected from the move mask when the second press never arrives', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    canvas.dispatch('pointerdown', pointerEvent({ buttons: 1 }))
    // Some browsers fire no `pointerdown` for a second button while the first is held; the
    // move's `buttons` mask is authoritative (`Viewport.tsx` onPointerMove).
    canvas.dispatch('pointermove', pointerEvent({ buttons: 3, clientX: 160 }))
    frames.flush()
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.cancel'])
    canvas.dispatch('pointermove', pointerEvent({ buttons: 3, clientX: 180 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 0, buttons: 2 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 0 }))
    frames.flush()
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.cancel'], 'moves stay discarded')
    canvas.dispatch('pointerdown', pointerEvent({ buttons: 1 }))
    assert.equal(commands.at(-1).type, 'pointer.down', 'a chord never blocks the next press')
  } finally {
    frames.restore()
    detach()
  }
})

test('an unmatched release of the other button cancels a claimed right erase', () => {
  const { canvas, commands, frames, detach } = claimedSetup(true)
  try {
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2 }))
    // Right-up is what the browser reports when the left button is released during a right
    // drag: committing here would apply the erase the player tried to cancel.
    canvas.dispatch('pointerup', pointerEvent({ button: 0, buttons: 2 }))
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.cancel'])
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 0 }))
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.cancel'])
  } finally {
    frames.restore()
    detach()
  }
})

test('a claimed right erase keeps its drag and its own context menu', () => {
  const { canvas, commands, frames, detach } = claimedSetup(true)
  try {
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2 }))
    // A claimed erase drag owns the native menu even though no left button is held
    // (`ownsContextMenu`), because the browser can fire it at right-down.
    canvas.dispatch('contextmenu', pointerEvent({ button: 2, buttons: 2 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 0 }))
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.up'], 'the erase release still commits')
  } finally {
    frames.restore()
    detach()
  }
})

test('contextmenu cancels an unmatched secondary press during a held tool gesture', () => {
  const { canvas, commands, frames, detach } = setup()
  try {
    canvas.dispatch('pointerdown', pointerEvent({ buttons: 1 }))
    canvas.dispatch('contextmenu', pointerEvent({ button: 2, buttons: 1 }))
    assert.deepEqual(types(commands), ['pointer.down', 'pointer.cancel'])
  } finally {
    frames.restore()
    detach()
  }
})

test('a left press during a right camera pan is consumed, and the pan never starts from the chord', () => {
  const canvas = new FakeCanvas()
  const toolCommands = []
  const cameraCommands = []
  const frames = installFrames()
  const detachTool = attachCanvasToolPointer(canvas, { send: command => toolCommands.push(command) }, {
    claimsRight: () => false,
  })
  const detachCamera = attachCanvasCameraGestures(canvas, { send: command => cameraCommands.push(command) }, {
    claimsRight: () => false,
  })
  try {
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2 }))
    canvas.dispatch('pointermove', pointerEvent({ button: -1, buttons: 2, clientX: 140 }))
    assert.equal(cameraCommands.length, 1, 'the right pan integrates its own drag')
    canvas.dispatch('pointerdown', pointerEvent({ button: 0, buttons: 3 }))
    assert.equal(toolCommands.length, 0, 'the second press of a chord starts no tool gesture and needs no cancel')
    canvas.dispatch('pointermove', pointerEvent({ button: -1, buttons: 3, clientX: 180 }))
    assert.equal(cameraCommands.length, 1, 'the chord stops the pan instead of feeding it')
    canvas.dispatch('pointerup', pointerEvent({ button: 2, buttons: 1 }))
    canvas.dispatch('pointerup', pointerEvent({ button: 0, buttons: 0 }))
    frames.flush()
    assert.deepEqual(types(toolCommands), [], 'neither release commits a tool gesture')
  } finally {
    frames.restore()
    detachCamera()
    detachTool()
  }
})

test('a camera pan stops on an unmatched release instead of drifting', () => {
  const canvas = new FakeCanvas()
  const sent = []
  const detach = attachCanvasCameraGestures(canvas, { send: command => sent.push(command) }, {
    claimsRight: () => false,
  })
  try {
    canvas.dispatch('pointerdown', pointerEvent({ button: 2, buttons: 2 }))
    canvas.dispatch('pointermove', pointerEvent({ button: -1, buttons: 2, clientX: 140 }))
    assert.equal(sent.length, 1)
    canvas.dispatch('pointerup', pointerEvent({ button: 0, buttons: 2 }))
    canvas.dispatch('pointermove', pointerEvent({ button: -1, buttons: 2, clientX: 180 }))
    assert.equal(sent.length, 1, 'a pan whose release was unmatched does not keep moving')
  } finally {
    detach()
  }
})
