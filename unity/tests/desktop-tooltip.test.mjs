// Pure-DOM hover tooltip for Unity desktop / Editor WebView2 (`html.metro-overlay`),
// restoring native HTML `title` tooltips that Chromium otherwise draws in an offscreen OS HWND.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DESKTOP_TOOLTIP_DELAY_MS,
  DESKTOP_TOOLTIP_MARGIN_PX,
  DESKTOP_TOOLTIP_WARM_DELAY_MS,
  attachDesktopTooltip,
  findTooltipTarget,
  positionDesktopTooltip,
} from '../../game/src/unity-web/desktopTooltip.ts'

const repoRoot = resolve(import.meta.dirname, '../..')

function makeFakeElement(tag, attrs = {}, parent = null) {
  const map = new Map(Object.entries(attrs))
  const el = {
    tagName: tag.toUpperCase(),
    parentElement: parent,
    parentNode: parent,
    isConnected: true,
    hidden: false,
    className: '',
    textContent: '',
    style: {},
    popoverOpen: false,
    removed: false,
    rect: { width: 120, height: 26 },
    hasAttribute(name) { return map.has(name) },
    getAttribute(name) { return map.has(name) ? map.get(name) : null },
    setAttribute(name, value) { map.set(name, String(value)) },
    getBoundingClientRect() { return this.rect },
    showPopover() { this.popoverOpen = true },
    hidePopover() { this.popoverOpen = false },
    remove() { this.removed = true; this.isConnected = false },
  }
  return el
}

function makeListenerHub() {
  const listeners = new Map()
  return {
    addEventListener(type, fn) {
      let set = listeners.get(type)
      if (!set) { set = new Set(); listeners.set(type, set) }
      set.add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatch(type, event = {}) {
      const ev = { type, ...event }
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev)
      return ev
    },
  }
}

function makeFakeDom() {
  const docHub = makeListenerHub()
  const winHub = makeListenerHub()
  const appended = []
  const body = {
    appendChild(el) { appended.push(el); return el },
  }
  const fakeDoc = {
    body,
    documentElement: { clientWidth: 1280, clientHeight: 720 },
    createElement(tag) { return makeFakeElement(tag) },
    addEventListener: docHub.addEventListener,
    removeEventListener: docHub.removeEventListener,
    dispatch: docHub.dispatch,
  }
  const fakeWin = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: winHub.addEventListener,
    removeEventListener: winHub.removeEventListener,
    dispatch: winHub.dispatch,
  }
  return { fakeDoc, fakeWin, appended }
}

test('findTooltipTarget resolves nearest titled ancestor and honours empty title suppression', () => {
  const button = makeFakeElement('button', { title: '新建车站 (Ctrl+N)' })
  const svg = makeFakeElement('svg', {}, button)
  const path = makeFakeElement('path', {}, svg)
  assert.deepEqual(findTooltipTarget(path), { element: button, text: '新建车站 (Ctrl+N)' })
  assert.deepEqual(findTooltipTarget(button), { element: button, text: '新建车站 (Ctrl+N)' })

  // Explicit empty title="" suppresses parent tooltip (HTML spec).
  const suppressed = makeFakeElement('span', { title: '' }, button)
  const child = makeFakeElement('i', {}, suppressed)
  assert.equal(findTooltipTarget(child), null)

  // Whitespace-only title is ignored.
  const blank = makeFakeElement('div', { title: '   ' })
  assert.equal(findTooltipTarget(blank), null)

  // Non-element SVG/Text node with only parentNode walks up to titled parent.
  const textNode = { nodeType: 3, parentNode: svg }
  assert.deepEqual(findTooltipTarget(textNode), { element: button, text: '新建车站 (Ctrl+N)' })

  assert.equal(findTooltipTarget(null), null)
})

test('positionDesktopTooltip offsets from pointer, clamps right edge, and flips above bottom edge', () => {
  const vp = { width: 1280, height: 720 }
  // Normal TopBar hover: appears below and right of pointer.
  assert.deepEqual(
    positionDesktopTooltip({ x: 200, y: 24 }, { width: 140, height: 26 }, vp, 1),
    { left: 212, top: 44 },
  )

  // Near right edge (e.g. Settings button): shifts left inside margin.
  const rightPos = positionDesktopTooltip({ x: 1260, y: 24 }, { width: 120, height: 26 }, vp, 1)
  assert.equal(rightPos.left, 1280 - 120 - DESKTOP_TOOLTIP_MARGIN_PX)
  assert.equal(rightPos.top, 44)

  // Near bottom edge (e.g. BottomBar): flips above pointer.
  const bottomPos = positionDesktopTooltip({ x: 400, y: 705 }, { width: 120, height: 26 }, vp, 1)
  assert.equal(bottomPos.left, 412)
  assert.equal(bottomPos.top, 705 - 26 - 10)

  // Scales offset cleanly with UI scale.
  assert.deepEqual(
    positionDesktopTooltip({ x: 100, y: 30 }, { width: 100, height: 26 }, vp, 1.5),
    { left: 118, top: 60 },
  )
})

test('attachDesktopTooltip shows on hover delay, hands off warmly between buttons, and dismisses on interaction', () => {
  const { fakeDoc, fakeWin, appended } = makeFakeDom()
  let clock = 1000
  let nextTimerId = 1
  const timers = new Map()
  const fireTimers = () => {
    const entries = [...timers.entries()]
    timers.clear()
    for (const [, entry] of entries) entry.fn()
  }

  const detach = attachDesktopTooltip({
    documentTarget: fakeDoc,
    windowTarget: fakeWin,
    getScale: () => 1,
    now: () => clock,
    setTimeoutFn: (fn, ms) => {
      const id = nextTimerId++
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeoutFn: id => { timers.delete(id) },
  })

  try {
    assert.equal(appended.length, 1)
    const tip = appended[0]
    assert.equal(tip.className, 'metro-desktop-tooltip')
    assert.equal(tip.getAttribute('role'), 'tooltip')
    assert.equal(tip.getAttribute('popover'), 'manual')
    assert.equal(tip.hidden, true)

    const btnNew = makeFakeElement('button', { title: '新建车站 (Ctrl+N)' })
    const iconNew = makeFakeElement('svg', {}, btnNew)
    const btnExamples = makeFakeElement('button', { title: '示例车站 (Ctrl+Shift+N)' })
    const emptyBar = makeFakeElement('div')

    // Cold hover schedules standard delay and does not show immediately.
    fakeDoc.dispatch('pointermove', { clientX: 160, clientY: 24, buttons: 0, pointerType: 'mouse', target: iconNew })
    assert.equal(tip.hidden, true)
    assert.equal([...timers.values()][0].ms, DESKTOP_TOOLTIP_DELAY_MS)

    clock += DESKTOP_TOOLTIP_DELAY_MS
    fireTimers()
    assert.equal(tip.hidden, false)
    assert.equal(tip.popoverOpen, true)
    assert.equal(tip.textContent, '新建车站 (Ctrl+N)')
    assert.equal(tip.style.left, '172px')
    assert.equal(tip.style.top, '44px')

    // Moving directly to adjacent TopBar button uses warm shorter delay.
    fakeDoc.dispatch('pointermove', { clientX: 210, clientY: 24, buttons: 0, pointerType: 'mouse', target: btnExamples })
    assert.equal(tip.hidden, true, 'old tooltip hides while transitioning to next button')
    assert.equal([...timers.values()][0].ms, DESKTOP_TOOLTIP_WARM_DELAY_MS)

    clock += DESKTOP_TOOLTIP_WARM_DELAY_MS
    fireTimers()
    assert.equal(tip.hidden, false)
    assert.equal(tip.textContent, '示例车站 (Ctrl+Shift+N)')

    // Clicking dismisses tooltip immediately.
    fakeDoc.dispatch('pointerdown', { clientX: 210, clientY: 24 })
    assert.equal(tip.hidden, true)
    assert.equal(tip.popoverOpen, false)

    // Dragging (buttons !== 0) never opens a tooltip.
    fakeDoc.dispatch('pointermove', { clientX: 160, clientY: 24, buttons: 1, pointerType: 'mouse', target: btnNew })
    assert.equal(timers.size, 0)
    assert.equal(tip.hidden, true)

    // Touch move never opens a tooltip.
    fakeDoc.dispatch('pointermove', { clientX: 160, clientY: 24, buttons: 0, pointerType: 'touch', target: btnNew })
    assert.equal(timers.size, 0)

    // Hovering untitled area hides active tooltip cleanly.
    clock += 1000
    fakeDoc.dispatch('pointermove', { clientX: 160, clientY: 24, buttons: 0, pointerType: 'mouse', target: btnNew })
    fireTimers()
    assert.equal(tip.hidden, false)
    fakeDoc.dispatch('pointermove', { clientX: 400, clientY: 24, buttons: 0, pointerType: 'mouse', target: emptyBar })
    assert.equal(tip.hidden, true)

    // Window blur and keydown dismiss tooltip.
    fakeDoc.dispatch('pointermove', { clientX: 160, clientY: 24, buttons: 0, pointerType: 'mouse', target: btnNew })
    fireTimers()
    assert.equal(tip.hidden, false)
    fakeWin.dispatch('blur')
    assert.equal(tip.hidden, true)

    fakeDoc.dispatch('pointermove', { clientX: 160, clientY: 24, buttons: 0, pointerType: 'mouse', target: btnNew })
    fireTimers()
    assert.equal(tip.hidden, false)
    fakeDoc.dispatch('keydown', { key: 'Escape' })
    assert.equal(tip.hidden, true)
  } finally {
    detach()
  }

  assert.equal(appended[0].removed, true, 'dispose removes the tooltip DOM element')
  assert.equal(timers.size, 0)
})

test('main.tsx and unity-ui.css wire desktop hover tooltips only for desktopOverlay', () => {
  const mainSource = readFileSync(join(repoRoot, 'game/src/unity-web/main.tsx'), 'utf8')
  const cssSource = readFileSync(join(repoRoot, 'game/src/unity-web/unity-ui.css'), 'utf8')
  assert.match(mainSource, /import \{ attachDesktopTooltip \} from '\.\/desktopTooltip\.ts'/)
  assert.match(mainSource, /desktopOverlay\s*\?\s*attachDesktopTooltip\(\{ getScale: getUiScale \}\)/)
  assert.match(mainSource, /detachDesktopTooltip\(\)/)
  assert.match(cssSource, /\.metro-desktop-tooltip\s*\{/)
  assert.match(cssSource, /pointer-events:\s*none/)
})
