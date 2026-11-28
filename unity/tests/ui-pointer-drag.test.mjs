import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  attachScrollbarDragFallback,
  beginPointerDrag,
  sliderValueForPointer,
} from '../../game/src/app/pointerDrag.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8')

function withFakeWindow(fn) {
  const originalWindow = globalThis.window
  const originalElement = globalThis.Element
  const originalHTMLElement = globalThis.HTMLElement
  const fakeWindow = new EventTarget()
  fakeWindow.getComputedStyle = (el) => el._style ?? {}
  class FakeElement {
    constructor() { this.captured = new Set() }
    setPointerCapture(id) { this.captured.add(id) }
    hasPointerCapture(id) { return this.captured.has(id) }
    releasePointerCapture(id) { this.captured.delete(id) }
  }
  class FakeHTMLElement extends FakeElement {}
  globalThis.window = fakeWindow
  globalThis.Element = FakeElement
  globalThis.HTMLElement = FakeHTMLElement
  try {
    return fn({ fakeWindow, FakeElement, FakeHTMLElement })
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    if (originalElement === undefined) delete globalThis.Element
    else globalThis.Element = originalElement
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement
    else globalThis.HTMLElement = originalHTMLElement
  }
}

function makePointerEvent(type, props = {}) {
  const ev = new Event(type, { cancelable: true, bubbles: true })
  Object.assign(ev, {
    button: 0,
    buttons: 1,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...props,
  })
  ev.stopped = false
  const origStop = ev.stopPropagation.bind(ev)
  ev.stopPropagation = () => { ev.stopped = true; origStop() }
  return ev
}

test('sliderValueForPointer maps track positions across all game slider ranges with clean step precision', () => {
  // FOV: 30..120, step 1, 100px track (inset 5px -> usable 90px)
  assert.equal(sliderValueForPointer(0, 10, 100, 100, 30, 120, 1), 30)
  assert.equal(sliderValueForPointer(15, 10, 100, 100, 30, 120, 1), 30)
  assert.equal(sliderValueForPointer(60, 10, 100, 100, 30, 120, 1), 75)
  assert.equal(sliderValueForPointer(105, 10, 100, 100, 30, 120, 1), 120)
  assert.equal(sliderValueForPointer(250, 10, 100, 100, 30, 120, 1), 120)

  // Exit inflow: 0..6000, step 10
  assert.equal(sliderValueForPointer(60, 10, 100, 100, 0, 6000, 10), 3000)
  assert.equal(sliderValueForPointer(15 + 45 * 0.333, 10, 100, 100, 0, 6000, 10) % 10, 0)

  // Line load per car: 0..400, step 10
  assert.equal(sliderValueForPointer(60, 10, 100, 100, 0, 400, 10), 200)

  // Settings audio volume: 0..100, step "1"
  assert.equal(sliderValueForPointer(60, 10, 100, 100, 0, 100, '1'), 50)

  // Crowdflow demand knobs: 0..2.5 and 0.4..2, step 0.01 (no float drift like 0.30000000000000004)
  const knobVal = sliderValueForPointer(15 + 90 * (0.3 / 2.5), 10, 100, 100, 0, 2.5, 0.01)
  assert.equal(knobVal, 0.3)
  assert.equal(String(knobVal), '0.3')
  const steep = sliderValueForPointer(15 + 90 * 0.5, 10, 100, 100, 0.4, 2, 0.01)
  assert.equal(steep, 1.2)
})

test('beginPointerDrag tracks window-scoped moves through release and cancels on lost button or blur', () => {
  withFakeWindow(({ fakeWindow, FakeElement }) => {
    const el = new FakeElement()
    const moves = []
    const ends = []
    let prevented = false

    const stop = beginPointerDrag({
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 20,
      currentTarget: el,
      preventDefault: () => { prevented = true },
    }, {
      onMove: (x, y) => moves.push([x, y]),
      onEnd: (completed) => ends.push(completed),
    })

    assert.ok(stop)
    assert.equal(prevented, true)
    assert.equal(el.hasPointerCapture(7), true)

    // Unrelated pointer is ignored.
    const other = makePointerEvent('pointermove', { pointerId: 99, clientX: 999, clientY: 999, buttons: 1 })
    fakeWindow.dispatchEvent(other)
    assert.equal(moves.length, 0)
    assert.equal(other.stopped, false)

    // Held move is captured and propagated to onMove.
    const m1 = makePointerEvent('pointermove', { pointerId: 7, clientX: 50, clientY: 90, buttons: 1 })
    fakeWindow.dispatchEvent(m1)
    assert.deepEqual(moves, [[50, 90]])
    assert.equal(m1.stopped, true)

    // Release emits final coordinates and completes cleanly.
    const up = makePointerEvent('pointerup', { pointerId: 7, button: 0, buttons: 0, clientX: 80, clientY: 120 })
    fakeWindow.dispatchEvent(up)
    assert.deepEqual(moves, [[50, 90], [80, 120]])
    assert.deepEqual(ends, [true])
    assert.equal(up.stopped, true)
    assert.equal(el.hasPointerCapture(7), false)

    // Further moves after release are ignored.
    fakeWindow.dispatchEvent(makePointerEvent('pointermove', { pointerId: 7, clientX: 100, clientY: 140, buttons: 1 }))
    assert.equal(moves.length, 2)

    // Lost held bit on move cancels the gesture instead of sticking.
    const ends2 = []
    beginPointerDrag({
      button: 0, pointerId: 8, clientX: 0, clientY: 0, currentTarget: el, preventDefault: () => {},
    }, {
      onMove: () => {},
      onEnd: (completed) => ends2.push(completed),
    })
    fakeWindow.dispatchEvent(makePointerEvent('pointermove', { pointerId: 8, clientX: 10, clientY: 10, buttons: 0 }))
    assert.deepEqual(ends2, [false])
    assert.equal(el.hasPointerCapture(8), false)

    // Window blur also cancels cleanly.
    const ends3 = []
    beginPointerDrag({
      button: 0, pointerId: 9, clientX: 0, clientY: 0, currentTarget: el, preventDefault: () => {},
    }, {
      onMove: () => {},
      onEnd: (completed) => ends3.push(completed),
    })
    fakeWindow.dispatchEvent(new Event('blur'))
    assert.deepEqual(ends3, [false])
  })
})

test('attachScrollbarDragFallback smoothly drags vertical and horizontal scrollbars when DOM moves arrive', () => {
  withFakeWindow(({ fakeWindow, FakeHTMLElement }) => {
    const detach = attachScrollbarDragFallback()
    try {
      const scroller = new FakeHTMLElement()
      scroller._style = { overflowY: 'auto', overflowX: 'hidden', borderRightWidth: '1px', borderBottomWidth: '1px' }
      scroller.offsetWidth = 210
      scroller.clientWidth = 200
      scroller.clientLeft = 1
      scroller.clientTop = 1
      scroller.clientHeight = 200
      scroller.scrollHeight = 1000
      scroller.scrollTop = 0
      scroller.scrollWidth = 200
      scroller.offsetHeight = 202
      scroller.parentElement = null
      scroller.getBoundingClientRect = () => ({ left: 20, top: 30, right: 230, bottom: 232, width: 210, height: 202 })

      // Click inside content area (x=100) must NOT trigger scrollbar drag.
      const contentDown = makePointerEvent('pointerdown', { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 50 })
      Object.defineProperty(contentDown, 'target', { value: scroller })
      fakeWindow.dispatchEvent(contentDown)
      fakeWindow.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, buttons: 1, clientX: 100, clientY: 120 }))
      assert.equal(scroller.scrollTop, 0)
      fakeWindow.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, button: 0, buttons: 0, clientX: 100, clientY: 120 }))

      // Press on vertical scrollbar thumb (gutter is 221..229), drag diagonally outside the panel.
      const sbDown = makePointerEvent('pointerdown', { button: 0, buttons: 1, pointerId: 2, clientX: 225, clientY: 45 })
      Object.defineProperty(sbDown, 'target', { value: scroller })
      fakeWindow.dispatchEvent(sbDown)
      // Must NOT preventDefault on pointerdown so native Blink scrollbar drag wins when available.
      assert.equal(sbDown.defaultPrevented, false)

      // Simulated leaked move (as when CDP sends button: "none").
      fakeWindow.dispatchEvent(makePointerEvent('pointermove', { pointerId: 2, buttons: 1, clientX: 350, clientY: 125 }))
      // track=200, thumb=(200/1000)*200=40, thumbSpan=160, maxScroll=800 -> dy=80 => scrollTop=400.
      assert.equal(scroller.scrollTop, 400)

      fakeWindow.dispatchEvent(makePointerEvent('pointerup', { pointerId: 2, button: 0, buttons: 0, clientX: 350, clientY: 165 }))
      assert.equal(scroller.scrollTop, 600)
    } finally {
      detach()
    }
  })
})

test('all sliders, curve grips, depth rail, scrollbars and Unity CDP forwarding share the smooth drag fix', () => {
  const sliderSrc = read('game/src/app/Slider.tsx')
  assert.match(sliderSrc, /beginPointerDrag/)
  assert.match(sliderSrc, /sliderValueForPointer/)

  const appShellSrc = read('game/src/app/windows/AppShell.tsx')
  assert.match(appShellSrc, /attachScrollbarDragFallback/)

  const viewCubeSrc = read('game/src/app/ViewCube.tsx')
  assert.match(viewCubeSrc, /beginPointerDrag/)
  assert.match(viewCubeSrc, /onDragStart=\{\(\) => setFovDragging\(true\)\}/)
  assert.match(viewCubeSrc, /onDragEnd=\{\(\) => setFovDragging\(false\)\}/)

  const dayCurveSrc = read('game/src/app/windows/time/DayCurve.tsx')
  assert.match(dayCurveSrc, /beginPointerDrag/)

  const timePanelSrc = read('game/src/app/windows/time/TimePanel.tsx')
  assert.match(timePanelSrc, /knobDraftRef/)
  assert.match(timePanelSrc, /spanDraftRef/)
  assert.match(timePanelSrc, /onDragEnd=/)

  const exitCardSrc = read('game/src/app/windows/inspector/ExitCard.tsx')
  assert.match(exitCardSrc, /<Slider[\s\S]*onDragStart=\{pick\}/)

  // Every slider call site uses the shared Slider component (no raw <input type="range">).
  for (const rel of [
    'game/src/app/ViewCube.tsx',
    'game/src/app/windows/inspector/ExitCard.tsx',
    'game/src/app/windows/inspector/LineCard.tsx',
    'game/src/app/windows/time/TimePanel.tsx',
    'game/src/app/windows/topbar/SettingsMenu.tsx',
    'game/src/app/windows/topbar/MusicSetting.tsx',
    'game/src/app/windows/topbar/UiScaleSetting.tsx',
  ]) {
    const src = read(rel)
    assert.match(src, /<Slider\b/, `${rel} must use shared Slider`)
    assert.doesNotMatch(src, /type=["']range["']/, `${rel} must not bypass shared Slider`)
  }

  // Line colour editing uses the pure-DOM popover picker + beginPointerDrag
  // (never native <input type="color">, whose OS popup HWND is invisible in WebView2).
  const lineCardSrc = read('game/src/app/windows/inspector/LineCard.tsx')
  assert.match(lineCardSrc, /<LineColourPicker\b/)
  assert.doesNotMatch(lineCardSrc, /type=["']color["']/, 'LineCard must not use native <input type="color">')
  const linePickerSrc = read('game/src/app/windows/inspector/LineColourPicker.tsx')
  assert.match(linePickerSrc, /popover="auto"/)
  assert.match(linePickerSrc, /beginPointerDrag/)
  assert.match(linePickerSrc, /cityLineColourPresets/)

  // Unity desktop WebView2 host and presenter send the active held button on mouseMoved.
  const hostSrc = read('tools/unity-editor-ui/Program.cs')
  assert.match(hostSrc, /ResolveCdpMouseButton/)
  assert.match(hostSrc, /cdpType == "mouseMoved"/)

  const presenterSrc = read('unity/Assets/StationDesigner/Runtime/App/StationDesktopUiPresenter.cs')
  assert.match(presenterSrc, /HeldButtonName/)
  assert.match(presenterSrc, /SendMouse\("move", rx, ry, HeldButtonName\(buttons\), buttons, mods, 0, 0, 0\)/)
})
