// Pure-DOM hover tooltip for the Unity desktop / Editor WebView2 overlay (`html.metro-overlay`).
//
// In desktop/Editor mode (`MetroEditorWebView.exe`), Chromium renders offscreen via
// `CoreWebView2CompositionController` on a 1×1 click-through `HWND_BOTTOM` anchor captured
// through `Windows.Graphics.Capture`. Native browser `title="..."` tooltip popups live in a
// separate top-level OS HWND outside that captured visual tree, so they never appear on screen.
//
// This module restores native web UI `title` hover tooltips inside the DOM (rendered in the CSS
// top layer via `popover="manual"` so tooltips also appear cleanly above `<dialog>` modals and
// `popover="auto"` menus) while leaving browser WebGL / Three.js native tooltips untouched.

export const DESKTOP_TOOLTIP_DELAY_MS = 400
export const DESKTOP_TOOLTIP_WARM_DELAY_MS = 100
export const DESKTOP_TOOLTIP_WARM_WINDOW_MS = 350
export const DESKTOP_TOOLTIP_MARGIN_PX = 8

export interface TooltipNodeLike {
  nodeType?: number
  parentElement?: TooltipElementLike | null
  parentNode?: TooltipNodeLike | null
}

export interface TooltipElementLike extends TooltipNodeLike {
  hasAttribute?(name: string): boolean
  getAttribute?(name: string): string | null
  isConnected?: boolean
}

export interface TooltipMatch {
  element: TooltipElementLike
  text: string
}

export interface TooltipPoint {
  x: number
  y: number
}

export interface TooltipSize {
  width: number
  height: number
}

export interface TooltipViewport {
  width: number
  height: number
}

function isElementLike(node: unknown): node is TooltipElementLike {
  return Boolean(
    node &&
    typeof node === 'object' &&
    typeof (node as TooltipElementLike).getAttribute === 'function',
  )
}

function parentElementOf(node: TooltipNodeLike | null | undefined): TooltipElementLike | null {
  if (!node) return null
  if (isElementLike(node.parentElement)) return node.parentElement
  let cur = node.parentNode ?? null
  while (cur) {
    if (isElementLike(cur)) return cur
    cur = cur.parentNode ?? null
  }
  return null
}

/**
 * Resolve the nearest ancestor (or target itself) that owns an HTML `title` tooltip.
 * Follows the HTML spec: an explicit empty `title=""` on a closer element suppresses
 * any ancestor tooltip rather than inheriting it.
 */
export function findTooltipTarget(target: unknown): TooltipMatch | null {
  let el: TooltipElementLike | null = isElementLike(target)
    ? target
    : parentElementOf(target as TooltipNodeLike | null | undefined)
  while (el) {
    const hasTitle = typeof el.hasAttribute === 'function'
      ? el.hasAttribute('title')
      : el.getAttribute?.('title') !== null && el.getAttribute?.('title') !== undefined
    if (hasTitle) {
      const raw = el.getAttribute?.('title') ?? ''
      const text = raw.trim()
      return text.length > 0 ? { element: el, text } : null
    }
    el = parentElementOf(el)
  }
  return null
}

/**
 * Place a viewport-fixed tooltip near the pointer, mirroring native Windows/Chromium
 * cursor-offset tooltips while clamping inside the window and flipping above the pointer
 * near the bottom edge.
 */
export function positionDesktopTooltip(
  pointer: TooltipPoint,
  tipSize: TooltipSize,
  viewport: TooltipViewport,
  scale = 1,
): { left: number; top: number } {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const margin = DESKTOP_TOOLTIP_MARGIN_PX
  const offsetX = Math.round(12 * safeScale)
  const offsetY = Math.round(20 * safeScale)
  const flipGap = Math.round(10 * safeScale)
  const width = Math.max(0, Number.isFinite(tipSize.width) ? tipSize.width : 0)
  const height = Math.max(0, Number.isFinite(tipSize.height) ? tipSize.height : 0)
  const vw = Math.max(margin * 2, Number.isFinite(viewport.width) ? viewport.width : 0)
  const vh = Math.max(margin * 2, Number.isFinite(viewport.height) ? viewport.height : 0)

  let left = pointer.x + offsetX
  if (left + width > vw - margin) {
    left = vw - width - margin
  }
  left = Math.max(margin, left)

  let top = pointer.y + offsetY
  if (top + height > vh - margin) {
    const flipped = pointer.y - height - flipGap
    top = flipped >= margin ? flipped : Math.max(margin, vh - height - margin)
  }
  top = Math.max(margin, top)

  return { left: Math.round(left), top: Math.round(top) }
}

export interface DesktopTooltipOptions {
  documentTarget?: Document | null
  windowTarget?: Window | null
  getScale?: () => number
  showDelayMs?: number
  warmDelayMs?: number
  warmWindowMs?: number
  now?: () => number
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

type PopoverElement = HTMLElement & {
  showPopover?: () => void
  hidePopover?: () => void
}

/**
 * Attach a single shared pure-DOM hover tooltip for all `[title]` elements in the document.
 * Returns a cleanup callback that removes listeners, timers, and the tooltip element.
 */
export function attachDesktopTooltip(options: DesktopTooltipOptions = {}): () => void {
  const doc = options.documentTarget ?? (typeof document !== 'undefined' ? document : null)
  const win = options.windowTarget ?? (typeof window !== 'undefined' ? window : null)
  if (!doc || !doc.body) return () => {}

  const showDelayMs = options.showDelayMs ?? DESKTOP_TOOLTIP_DELAY_MS
  const warmDelayMs = options.warmDelayMs ?? DESKTOP_TOOLTIP_WARM_DELAY_MS
  const warmWindowMs = options.warmWindowMs ?? DESKTOP_TOOLTIP_WARM_WINDOW_MS
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const clearTimer = options.clearTimeoutFn ?? (handle => { globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) })
  const getScale = options.getScale ?? (() => 1)

  const tip = doc.createElement('div') as PopoverElement
  tip.className = 'metro-desktop-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.setAttribute('popover', 'manual')
  tip.hidden = true
  doc.body.appendChild(tip)

  let pendingTimer: unknown = null
  let hoveredElement: TooltipElementLike | null = null
  let shownElement: TooltipElementLike | null = null
  let lastPointer: TooltipPoint = { x: 0, y: 0 }
  let lastVisibleAt = -Infinity
  let disposed = false

  const clearPending = (): void => {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer)
      pendingTimer = null
    }
  }

  const hidePopoverSafe = (): void => {
    try { tip.hidePopover?.() } catch { /* popover already closed or unsupported */ }
  }

  const showPopoverSafe = (): void => {
    try { tip.showPopover?.() } catch { /* popover already open or unsupported */ }
  }

  const hide = (recordWarm = false): void => {
    clearPending()
    if (shownElement !== null) {
      if (recordWarm) lastVisibleAt = now()
      shownElement = null
    }
    if (!tip.hidden) {
      hidePopoverSafe()
      tip.hidden = true
      tip.textContent = ''
    }
  }

  const showFor = (element: TooltipElementLike): void => {
    if (disposed) return
    if (element.isConnected === false) {
      hoveredElement = null
      hide(false)
      return
    }
    const raw = element.getAttribute?.('title') ?? ''
    const text = raw.trim()
    if (!text) {
      hoveredElement = null
      hide(false)
      return
    }
    tip.textContent = text
    tip.hidden = false
    showPopoverSafe()
    const rect = typeof tip.getBoundingClientRect === 'function'
      ? tip.getBoundingClientRect()
      : { width: 0, height: 0 }
    const viewport: TooltipViewport = {
      width: win?.innerWidth ?? doc.documentElement?.clientWidth ?? 1280,
      height: win?.innerHeight ?? doc.documentElement?.clientHeight ?? 720,
    }
    const pos = positionDesktopTooltip(
      lastPointer,
      { width: rect.width, height: rect.height },
      viewport,
      getScale(),
    )
    tip.style.left = `${pos.left}px`
    tip.style.top = `${pos.top}px`
    shownElement = element
    lastVisibleAt = now()
  }

  const onPointerMove = (event: Event): void => {
    const pointer = event as PointerEvent
    if (pointer.pointerType === 'touch') return
    if (typeof pointer.buttons === 'number' && pointer.buttons !== 0) {
      hoveredElement = null
      hide(false)
      return
    }
    lastPointer = { x: pointer.clientX, y: pointer.clientY }
    const match = findTooltipTarget(pointer.target)
    if (!match) {
      hoveredElement = null
      hide(true)
      return
    }
    if (match.element === hoveredElement) {
      if (shownElement === match.element) {
        if (tip.textContent !== match.text) showFor(match.element)
        return
      }
      if (pendingTimer !== null) return
    }
    const wasWarm = shownElement !== null || (now() - lastVisibleAt) <= warmWindowMs
    hide(shownElement !== null)
    hoveredElement = match.element
    const delay = wasWarm ? warmDelayMs : showDelayMs
    pendingTimer = setTimer(() => {
      pendingTimer = null
      if (hoveredElement === match.element) showFor(match.element)
    }, delay)
  }

  const onDismiss = (): void => {
    hoveredElement = null
    hide(false)
  }

  doc.addEventListener('pointermove', onPointerMove, true)
  doc.addEventListener('pointerdown', onDismiss, true)
  doc.addEventListener('keydown', onDismiss, true)
  doc.addEventListener('wheel', onDismiss, true)
  doc.addEventListener('scroll', onDismiss, true)
  doc.addEventListener('mouseleave', onDismiss)
  win?.addEventListener('blur', onDismiss)

  return () => {
    disposed = true
    hoveredElement = null
    hide(false)
    doc.removeEventListener('pointermove', onPointerMove, true)
    doc.removeEventListener('pointerdown', onDismiss, true)
    doc.removeEventListener('keydown', onDismiss, true)
    doc.removeEventListener('wheel', onDismiss, true)
    doc.removeEventListener('scroll', onDismiss, true)
    doc.removeEventListener('mouseleave', onDismiss)
    win?.removeEventListener('blur', onDismiss)
    tip.remove()
  }
}
