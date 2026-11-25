// Shared gesture-scoped pointer drag helpers for UI controls (sliders, curve grips,
// depth rail, ViewCube, and scrollbar fallback).
//
// In Unity desktop WebView2, CDP `Input.dispatchMouseEvent` moves can target another
// element even after `setPointerCapture`, and native `<input type="range">` or
// scrollbars can ignore `mouseMoved` if a host omits the held button. Listening at
// window capture scope for the lifetime of one press keeps every UI drag smooth
// through release, cancellation, or window blur.

export interface PointerDownLike {
  button: number
  pointerId: number
  clientX: number
  clientY: number
  currentTarget: EventTarget | null
  preventDefault(): void
}

export interface PointerDragOptions {
  /** Mouse button that owns the gesture (defaults to 0 = primary/left). */
  button?: number
  /** Element to request pointer capture on (defaults to `event.currentTarget`). */
  capture?: Element | null
  /** Whether to call `event.preventDefault()` on press (defaults to true). */
  preventDefault?: boolean
  /** Whether to invoke `onMove` one final time at the release coordinates (defaults to true). */
  updateOnUp?: boolean
  /** Called on every held move (and release when `updateOnUp` is true). */
  onMove: (clientX: number, clientY: number, event: PointerEvent) => void
  /** Called once when the gesture ends (`completed` is true only on matching button release). */
  onEnd?: (completed: boolean, event: PointerEvent | FocusEvent | null) => void
}

function buttonMaskFor(button: number): number {
  if (button === 0) return 1
  if (button === 1) return 4
  if (button === 2) return 2
  return 0
}

/**
 * Start a window-capture-scoped pointer drag for one press.
 * Returns a cleanup callback that aborts the listeners (safe to call on unmount),
 * or `null` if the press was not for the expected button.
 */
export function beginPointerDrag(
  event: PointerDownLike,
  options: PointerDragOptions,
): (() => void) | null {
  const button = options.button ?? 0
  if (event.button !== button) return null
  if (options.preventDefault !== false) event.preventDefault()

  const { pointerId } = event
  const mask = buttonMaskFor(button)
  const captureTarget = options.capture !== undefined
    ? options.capture
    : (event.currentTarget instanceof Element ? event.currentTarget : null)
  const listeners = new AbortController()
  let finished = false

  const finish = (completed: boolean, endEvent: PointerEvent | FocusEvent | null): void => {
    if (finished) return
    finished = true
    listeners.abort()
    if (captureTarget) {
      try {
        if (captureTarget.hasPointerCapture?.(pointerId)) {
          captureTarget.releasePointerCapture(pointerId)
        }
      } catch {
        /* capture already released or unsupported in synthetic environment */
      }
    }
    options.onEnd?.(completed, endEvent)
  }

  const captureOpts = { capture: true, signal: listeners.signal }
  window.addEventListener('pointermove', (move) => {
    if (move.pointerId !== pointerId) return
    if (mask === 0 || (move.buttons & mask) !== 0) {
      move.stopPropagation()
      options.onMove(move.clientX, move.clientY, move)
    } else {
      finish(false, move)
    }
  }, captureOpts)

  window.addEventListener('pointerup', (up) => {
    if (up.pointerId !== pointerId || up.button !== button) return
    up.stopPropagation()
    if (options.updateOnUp !== false) {
      options.onMove(up.clientX, up.clientY, up)
    }
    finish(true, up)
  }, captureOpts)

  window.addEventListener('pointercancel', (cancel) => {
    if (cancel.pointerId === pointerId) finish(false, cancel)
  }, captureOpts)

  window.addEventListener('blur', (blurEvent) => {
    finish(false, blurEvent)
  }, { signal: listeners.signal })

  if (captureTarget) {
    try {
      captureTarget.setPointerCapture?.(pointerId)
    } catch {
      /* synthetic events or detached elements still work via window listeners */
    }
  }

  return () => finish(false, null)
}

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0
  const text = String(value).toLowerCase()
  const expIndex = text.indexOf('e-')
  if (expIndex >= 0) {
    const exp = Number(text.slice(expIndex + 2))
    const dot = text.indexOf('.')
    const frac = dot >= 0 ? expIndex - dot - 1 : 0
    return exp + frac
  }
  const dot = text.indexOf('.')
  return dot >= 0 ? text.length - dot - 1 : 0
}

/**
 * Map a pointer's `clientX` to a quantized slider value along a `.tileSlider` track
 * (accounting for the 10 px thumb inset and step precision).
 */
export function sliderValueForPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  offsetWidth: number,
  min: number,
  max: number,
  step?: number | string,
): number {
  if (max <= min) return min
  // The 10px thumb travels between the inset ends of the track.
  const inset = 5 * trackWidth / Math.max(1, offsetWidth)
  const usable = Math.max(1, trackWidth - 2 * inset)
  const fraction = Math.max(0, Math.min(1, (clientX - trackLeft - inset) / usable))
  const raw = min + fraction * (max - min)
  if (step === 'any') return Math.max(min, Math.min(max, raw))

  const parsedStep = step === undefined ? 1 : Number(step)
  const stepNum = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1
  const snapped = min + Math.round((raw - min) / stepNum) * stepNum
  const clamped = Math.max(min, Math.min(max, snapped))
  const decimals = Math.min(10, Math.max(decimalPlaces(stepNum), decimalPlaces(min)))
  return decimals > 0 ? Number(clamped.toFixed(decimals)) : Math.round(clamped)
}

export interface ScrollbarHit {
  element: HTMLElement
  axis: 'y' | 'x'
  trackOrigin: number
  trackSize: number
  maxScroll: number
  thumbSize: number
  thumbSpan: number
  onThumb: boolean
  startScroll: number
  startCoord: number
}

/**
 * Detect whether a primary press landed inside an element's native scrollbar gutter.
 * Returns `null` for clicks inside content or on non-scrollable elements.
 */
export function findScrollbarHit(target: EventTarget | null, clientX: number, clientY: number): ScrollbarHit | null {
  let node: HTMLElement | null = target instanceof HTMLElement ? target : null
  while (node) {
    const style = window.getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    const scaleX = node.offsetWidth > 0 ? rect.width / node.offsetWidth : 1
    const scaleY = node.offsetHeight > 0 ? rect.height / node.offsetHeight : 1
    const borderRight = (parseFloat(style.borderRightWidth) || 0) * scaleX
    const borderBottom = (parseFloat(style.borderBottomWidth) || 0) * scaleY

    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      const sbWidth = (node.offsetWidth - node.clientLeft - (parseFloat(style.borderRightWidth) || 0) - node.clientWidth) * scaleX
      const gutterLeft = rect.left + (node.clientLeft + node.clientWidth) * scaleX
      const gutterRight = rect.right - borderRight
      const trackOrigin = rect.top + node.clientTop * scaleY
      const trackBottom = rect.bottom - borderBottom
      if (sbWidth >= 4 && clientX >= gutterLeft && clientX <= gutterRight && clientY >= trackOrigin && clientY <= trackBottom) {
        const trackSize = Math.max(1, node.clientHeight * scaleY)
        const maxScroll = Math.max(1, node.scrollHeight - node.clientHeight)
        const thumbSize = Math.min(trackSize, Math.max(20 * scaleY, (node.clientHeight / node.scrollHeight) * trackSize))
        const thumbSpan = Math.max(1, trackSize - thumbSize)
        const thumbStart = (node.scrollTop / maxScroll) * thumbSpan
        const localY = clientY - trackOrigin
        return {
          element: node,
          axis: 'y',
          trackOrigin,
          trackSize,
          maxScroll,
          thumbSize,
          thumbSpan,
          onThumb: localY >= thumbStart - 2 && localY <= thumbStart + thumbSize + 2,
          startScroll: node.scrollTop,
          startCoord: clientY,
        }
      }
    }

    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth) {
      const sbHeight = (node.offsetHeight - node.clientTop - (parseFloat(style.borderBottomWidth) || 0) - node.clientHeight) * scaleY
      const gutterTop = rect.top + (node.clientTop + node.clientHeight) * scaleY
      const gutterBottom = rect.bottom - borderBottom
      const trackOrigin = rect.left + node.clientLeft * scaleX
      const trackRight = rect.right - borderRight
      if (sbHeight >= 4 && clientY >= gutterTop && clientY <= gutterBottom && clientX >= trackOrigin && clientX <= trackRight) {
        const trackSize = Math.max(1, node.clientWidth * scaleX)
        const maxScroll = Math.max(1, node.scrollWidth - node.clientWidth)
        const thumbSize = Math.min(trackSize, Math.max(20 * scaleX, (node.clientWidth / node.scrollWidth) * trackSize))
        const thumbSpan = Math.max(1, trackSize - thumbSize)
        const thumbStart = (node.scrollLeft / maxScroll) * thumbSpan
        const localX = clientX - trackOrigin
        return {
          element: node,
          axis: 'x',
          trackOrigin,
          trackSize,
          maxScroll,
          thumbSize,
          thumbSpan,
          onThumb: localX >= thumbStart - 2 && localX <= thumbStart + thumbSize + 2,
          startScroll: node.scrollLeft,
          startCoord: clientX,
        }
      }
    }

    node = node.parentElement
  }
  return null
}

/**
 * Passive fallback for native scrollbar dragging when a CDP host omits the held button
 * on `mouseMoved` (so Blink does not natively consume scrollbar drag moves).
 *
 * Does NOT call `preventDefault()` on `pointerdown`: when Blink handles the scrollbar
 * natively, Blink consumes `pointermove` and this fallback stays completely dormant.
 */
export function attachScrollbarDragFallback(): () => void {
  let activeCleanup: (() => void) | null = null

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || activeCleanup) return
    const hit = findScrollbarHit(event.target, event.clientX, event.clientY)
    if (!hit) return

    const { pointerId } = event
    const listeners = new AbortController()
    let startedScroll = false

    const apply = (coord: number): void => {
      const next = hit.onThumb
        ? hit.startScroll + ((coord - hit.startCoord) / hit.thumbSpan) * hit.maxScroll
        : (((coord - hit.trackOrigin) - hit.thumbSize / 2) / hit.thumbSpan) * hit.maxScroll
      const clamped = Math.max(0, Math.min(hit.maxScroll, next))
      if (hit.axis === 'y') hit.element.scrollTop = clamped
      else hit.element.scrollLeft = clamped
    }

    const finish = (): void => {
      listeners.abort()
      activeCleanup = null
    }
    activeCleanup = finish

    const opts = { capture: true, signal: listeners.signal }
    window.addEventListener('pointermove', (move) => {
      if (move.pointerId !== pointerId) return
      if ((move.buttons & 1) === 0) {
        finish()
        return
      }
      startedScroll = true
      move.stopPropagation()
      apply(hit.axis === 'y' ? move.clientY : move.clientX)
    }, opts)
    window.addEventListener('pointerup', (up) => {
      if (up.pointerId !== pointerId || up.button !== 0) return
      if (startedScroll) {
        up.stopPropagation()
        apply(hit.axis === 'y' ? up.clientY : up.clientX)
      }
      finish()
    }, opts)
    window.addEventListener('pointercancel', (cancel) => {
      if (cancel.pointerId === pointerId) finish()
    }, opts)
    window.addEventListener('blur', finish, { signal: listeners.signal })
  }

  window.addEventListener('pointerdown', onDown, true)
  return () => {
    window.removeEventListener('pointerdown', onDown, true)
    activeCleanup?.()
  }
}
