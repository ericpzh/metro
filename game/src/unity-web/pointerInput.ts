// The Unity player's canvas **tool** pointer stream (plan 16 §1.2). Camera gestures
// stay with `cameraAdapter.ts` (middle drag orbits, right drag pans, wheel zooms); this
// file forwards the left button, the pointer lifecycle and a right *tap* to the C#
// pointer router, which resolves one scene hit per event and runs the active tool.
//
// Why the React layer owns the event rather than Unity's InputSystem: the same shell
// runs as a WebGL player and as the in-canvas desktop/Editor WebView, and the WebView
// covers the Unity view. Listening on the canvas element means a click on a React
// panel never reaches the router (the UI owns its own pointer), and it keeps the one
// pick per event on the same side as the camera's own gesture arbitration.
//
// Coordinates are CSS pixels relative to the canvas plus the canvas box, so the host
// normalizes to its own drawing-buffer size and a DPR change cannot move the pick.

import { stationBridge } from './stationBridge.ts'
import type { StationBridge } from './stationBridge.ts'

/** One tool-pointer command in the bridge's v2 vocabulary. */
export type PointerCommand =
  | { type: 'pointer.down'; payload: PointerPayload }
  | { type: 'pointer.move'; payload: PointerPayload }
  | { type: 'pointer.up'; payload: PointerPayload }
  | { type: 'pointer.cancel'; payload: Record<string, unknown> }
  | { type: 'pointer.leave'; payload: Record<string, unknown> }
  | { type: 'pointer.rightTap'; payload: PointerPayload }

export interface PointerPayload {
  x: number
  y: number
  w: number
  h: number
  pointerId: number
  button: number
  buttons: number
  modifiers: number
  pointerType: string
  toolGeneration: number
  documentRevision: number
}

export interface ToolPointerOptions {
  /** True while the shared UI owns the pointer (a dialog, the benchmark lock, …). */
  blocked?: () => boolean
}

/**
 * Attach the tool pointer stream to the Unity canvas. Returns the detach function.
 *
 * A move is coalesced to one send per animation frame (the latest position wins), so a
 * fast drag cannot queue a pick per browser event. Presses and releases flush the
 * pending move first: the release's own pick is the one the commit uses.
 */export function attachCanvasToolPointer(
  canvas: HTMLCanvasElement,
  port: { send: (command: PointerCommand) => void } = stationBridgePort(),
  options: ToolPointerOptions = {},
): () => void {
  let pointerId = -1
  let downX = 0
  let downY = 0
  let downAt = 0
  let downButton = -1
  let pending: PointerEvent | null = null
  let frame = 0

  const blocked = (): boolean => options.blocked?.() === true

  const snapshot = (): { toolGeneration: number; documentRevision: number } => {
    const state = stationBridge.getSnapshot()
    const generation = state.state.toolGeneration
    return {
      toolGeneration: typeof generation === 'number' && Number.isFinite(generation) ? generation : -1,
      documentRevision: state.revision,
    }
  }

  const payload = (event: PointerEvent, button: number): PointerPayload => {
    const rect = canvas.getBoundingClientRect()
    const known = snapshot()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      w: Math.max(1, rect.width),
      h: Math.max(1, rect.height),
      pointerId: event.pointerId,
      button,
      buttons: event.buttons,
      modifiers: (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0),
      pointerType: event.pointerType || 'mouse',
      toolGeneration: known.toolGeneration,
      documentRevision: known.documentRevision,
    }
  }

  const flush = (): void => {
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    if (!pending) return
    const event = pending
    pending = null
    port.send({ type: 'pointer.move', payload: payload(event, 0) })
  }

  const schedule = (event: PointerEvent): void => {
    pending = event
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!pending) return
      const latest = pending
      pending = null
      port.send({ type: 'pointer.move', payload: payload(latest, 0) })
    })
  }

  const down = (event: PointerEvent): void => {
    if (event.button === 1) return
    if (event.button === 0) {
      if (blocked()) return
      pointerId = event.pointerId
      downX = event.clientX
      downY = event.clientY
      downAt = performance.now()
      downButton = 0
      try { canvas.setPointerCapture(event.pointerId) } catch { /* inside-canvas drag still works */ }
      flush()
      port.send({ type: 'pointer.down', payload: payload(event, 0) })
      return
    }
    if (event.button === 2) {
      if (blocked()) return
      // A right drag is the camera's pan; only a tap is a tool cancel/bulldoze, and
      // `up` decides which one it was.
      pointerId = event.pointerId
      downX = event.clientX
      downY = event.clientY
      downAt = performance.now()
      downButton = 2
    }
  }

  const move = (event: PointerEvent): void => {
    if (blocked()) return
    if (event.pointerType === 'touch') event.preventDefault()
    schedule(event)
  }

  const up = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return
    const wasButton = downButton
    const travelled = Math.hypot(event.clientX - downX, event.clientY - downY)
    const elapsed = performance.now() - downAt
    pointerId = -1
    downButton = -1
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    // The release's hit is the one a click-commit uses, so the queued move is flushed
    // first under the same event order the C# router expects.
    flush()
    if (blocked()) return
    if (wasButton === 2) {
      if (travelled <= 5 && elapsed <= 500) port.send({ type: 'pointer.rightTap', payload: payload(event, 2) })
      return
    }
    port.send({ type: 'pointer.up', payload: payload(event, event.button) })
  }

  const cancel = (): void => {
    const hadActivePointer = pointerId >= 0
    pointerId = -1
    downButton = -1
    pending = null
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    if (blocked() && !hadActivePointer) return
    port.send({ type: 'pointer.cancel', payload: {} })
  }

  // NB: `lostpointercapture` is **not** a cancel. Browsers fire it on every normal
  // release (and our `up` releases the capture), so treating it as cancellation dropped a
  // lifted piece the instant the player let go of it. Only a real `pointercancel`
  // (OS gesture, tab switch, device loss) ends the gesture.

  const leave = (): void => {
    if (pointerId >= 0 || blocked()) return
    port.send({ type: 'pointer.leave', payload: {} })
  }

  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', cancel)
  canvas.addEventListener('pointerleave', leave)
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', cancel)
    canvas.removeEventListener('pointerleave', leave)
    if (frame) cancelAnimationFrame(frame)
    pending = null
  }
}

/** The production port: commands go through the v2 bridge with no `expectedRevision`. */
export function stationBridgePort(bridge: StationBridge = stationBridge): { send: (command: PointerCommand) => void } {
  return {
    send(command: PointerCommand): void {
      bridge.send(command.type, command.payload)
    },
  }
}
