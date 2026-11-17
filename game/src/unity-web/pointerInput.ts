// The Unity player's canvas **tool** pointer stream (plan 16 §1.2, plan 27 §2). Camera
// gestures stay with `cameraAdapter.ts` (middle drag orbits, right drag pans, wheel zooms)
// and this file forwards the pointer lifecycle to the C# pointer router, which resolves one
// scene hit per event and runs the tool that **owned the press**.
//
// Why the React layer owns the event rather than Unity's InputSystem: the same shell runs
// as a WebGL player and as the in-canvas desktop/Editor WebView, and the WebView covers the
// Unity view. Listening on the canvas element means a click on a React panel never reaches
// the router (the UI owns its own pointer), and it keeps the one pick per event on the same
// side as the camera's own gesture arbitration.
//
// Both build buttons belong to the tools. The host publishes what the secondary button means
// for the committed tool (`state.rightClaim`: `erase` / `cancel` / `pan`):
//
// * `erase`  — a tool gesture (the block brush digs, a fence run comes down): the press,
//              its moves and its release all go to C#, and the camera never pans.
// * `cancel` — a right *tap* is a cancel/clear; a right **drag** still pans the camera, so
//              the press is not forwarded and `up` reports a tap only when it barely moved.
// * `pan`    — the camera owns the button entirely.
//
// Coordinates are CSS pixels relative to the canvas plus the canvas box, so the host
// normalizes to its own drawing-buffer size and a DPR change cannot move the pick.

import { stationBridge } from './stationBridge.ts'
import type { StationBridge } from './stationBridge.ts'
import { BUTTON_BIT, DOM_BUTTON, MOVE_BUTTON, isBuildButton } from './pointerButtons.ts'

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
  /** The client clock (`performance.now()`), so the host can test the reference's press thresholds. */
  time: number
}

export interface ToolPointerOptions {
  /** True while the shared UI owns the pointer (a dialog, the benchmark lock, …). */
  blocked?: () => boolean
  /**
   * True when the committed tool owns the secondary button (`state.rightClaim === 'erase'`).
   * The camera adapter consults the same predicate, so exactly one of the two consumes a
   * right press.
   */
  claimsRight?: () => boolean
}

/** How far a right press may travel and still count as a tap (`pointer.ts` tap test). */
const RIGHT_TAP_PX = 5
/** How long a right press may be held and still count as a tap. */
const RIGHT_TAP_MS = 500
/** `MouseEvent.buttons` bit for the primary button. */
const LEFT_BIT = BUTTON_BIT.left
/** `MouseEvent.buttons` bit for the secondary button. */
const RIGHT_BIT = BUTTON_BIT.right/**
 * Attach the tool pointer stream to the Unity canvas. Returns the detach function.
 *
 * A move is coalesced to one send per animation frame (the latest position wins), so a
 * fast drag cannot queue a pick per browser event. Presses and releases flush the
 * pending move first: the release's own pick is the one the commit uses.
 *
 * **Chord arbitration (plan 29 §2).** DOM mouse `pointerdown`/`pointerup` primarily track
 * the first press and the last release; the reference additionally treats a press of the
 * opposing button while one is held as a cancel (`Viewport.tsx`: the move's `buttons`
 * mask, the unmatched release and `contextmenu`). Here one press owns the tool stream at
 * a time and a chord that press:
 *
 * * discards the queued move and sends **one** `pointer.cancel` — no second `pointer.down`,
 *   no new erase/add gesture, and the camera adapter refuses the same chord;
 * * consumes both releases (including one captured outside the canvas) until the pointer
 *   really holds no button, so the still-held button's release cannot commit the gesture
 *   the player tried to cancel.
 *
 * A right drag the tool does not claim stays the camera's pan, and a claimed right erase
 * keeps its drag to its own release (`ownsContextMenu`).
 */
export function attachCanvasToolPointer(
  canvas: HTMLCanvasElement,
  port: { send: (command: PointerCommand) => void } = stationBridgePort(),
  options: ToolPointerOptions = {},
): () => void {
  let pointerId = -1
  let downX = 0
  let downY = 0
  let downAt = 0
  let downButton = -1
  let toolOwnsRight = false
  /** The press forwarded to the tool, so a chord only cancels a gesture that exists. */
  let toolPressed = false
  /** The owning pointer's live `buttons` mask, kept even when a move is discarded. */
  let heldMask = 0
  /** A chord already sent its one cancel; both releases stay consumed until the mask clears. */
  let chordConsumed = false
  let pending: PointerEvent | null = null
  let frame = 0

  const blocked = (): boolean => options.blocked?.() === true
  const claimsRight = (): boolean => options.claimsRight?.() === true
  const isMouseLike = (event: PointerEvent): boolean => event.pointerType !== 'touch'

  const snapshot = (): { toolGeneration: number; documentRevision: number } => {
    const state = stationBridge.getSnapshot()
    const generation = state.state.toolGeneration
    return {
      toolGeneration: typeof generation === 'number' && Number.isFinite(generation) ? generation : -1,
      documentRevision: state.revision,
    }
  }

  const frameRect = (): { left: number; top: number; width: number; height: number } => {
    const doc = (canvas as { ownerDocument?: Document }).ownerDocument ?? globalThis.document
    const win = doc?.defaultView ?? globalThis.window
    // In the desktop/Editor WebView2 overlay (`<html class="metro-overlay">`), Unity's
    // 3D camera renders across the full swapchain `(0..innerWidth, 0..innerHeight)` behind
    // the transparent `.stage` hole, while `#unity-canvas` stays docked inside `.stage` so
    // React sidebars/bars still block pointer events outside `.stage`.
    if (
      doc?.documentElement?.classList?.contains('metro-overlay') &&
      win &&
      win.innerWidth > 0 &&
      win.innerHeight > 0
    ) {
      return { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }
    }
    return canvas.getBoundingClientRect()
  }

  const payload = (event: PointerEvent, button: number): PointerPayload => {
    const rect = frameRect()
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
      time: performance.now(),
    }
  }

  const flush = (): void => {
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    if (!pending) return
    const event = pending
    pending = null
    // A move names **no** changed button (`MouseEvent.button` is 0/−1 for a motion), so it
    // travels with the unchanged-button sentinel and the event's real `buttons` mask. Sending
    // button 0 here made every move look like the left button's release: a held right erase
    // was cancelled by its own first move and the C# router never saw a right drag (plan 30 §1).
    port.send({ type: 'pointer.move', payload: payload(event, MOVE_BUTTON) })
  }

  const schedule = (event: PointerEvent): void => {
    pending = event
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!pending) return
      const latest = pending
      pending = null
      port.send({ type: 'pointer.move', payload: payload(latest, MOVE_BUTTON) })
    })
  }

  /**
   * Drop the press the player cancelled. The queued move goes with it — sending it first
   * would aim the gesture one last time — and one `pointer.cancel` is the whole message:
   * the C# router owns every tool's cancellation, clears both ghost layers and the badge,
   * and counts it as zero picks and zero revisions (plan 29 §2). A chord on a press the
   * tool never owned (a camera pan) cancels nothing in C#, so it sends nothing.
   */
  const cancelChord = (): void => {
    pending = null
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    if (chordConsumed) return
    chordConsumed = true
    const ownsTool = toolPressed
    downButton = -1
    toolOwnsRight = false
    toolPressed = false
    try {
      if (pointerId >= 0 && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    } catch { /* already released */ }
    if (!ownsTool || blocked()) return
    port.send({ type: 'pointer.cancel', payload: {} })
  }

  /** A chord already cancelled this press: consume events until the pointer holds nothing. */
  const consumeChord = (event: PointerEvent): void => {
    heldMask = event.buttons
    if ((heldMask & (LEFT_BIT | RIGHT_BIT)) === 0) {
      chordConsumed = false
      pointerId = -1
      downButton = -1
      toolPressed = false
    }
  }

  const down = (event: PointerEvent): void => {
    if (event.button === DOM_BUTTON.middle) return
    if (!isBuildButton(event.button)) return
    if (blocked()) return
    if (isMouseLike(event)) {
      // Some browsers deliver a `pointerdown` for the second button of a chord and some do
      // not; either way the press that is already held is the owner, and its gesture is
      // cancelled rather than joined by a second gesture (`Viewport.tsx` `startPointerTool`).
      if (chordConsumed) { consumeChord(event); return }
      if (heldMask !== 0 && (heldMask & (LEFT_BIT | RIGHT_BIT)) !== 0) {
        cancelChord()
        consumeChord(event)
        return
      }
    }
    heldMask = event.buttons
    pointerId = event.pointerId
    downX = event.clientX
    downY = event.clientY
    downAt = performance.now()
    downButton = event.button
    toolPressed = false
    if (event.button === DOM_BUTTON.left) {
      toolOwnsRight = false
      try { canvas.setPointerCapture(event.pointerId) } catch { /* inside-canvas drag still works */ }
      flush()
      toolPressed = true
      port.send({ type: 'pointer.down', payload: payload(event, DOM_BUTTON.left) })
      return
    }
    toolOwnsRight = claimsRight()
    if (!toolOwnsRight) return
    // The committed tool owns the secondary button: forward the press now, so the C#
    // gesture is armed by the same event the player pressed — a right **drag** then digs
    // a rectangle instead of panning the camera. Capture keeps the drag alive off-canvas.
    try { canvas.setPointerCapture(event.pointerId) } catch { /* inside-canvas drag still works */ }
    flush()
    toolPressed = true
    port.send({ type: 'pointer.down', payload: payload(event, DOM_BUTTON.right) })
  }

  const move = (event: PointerEvent): void => {
    if (chordConsumed) { consumeChord(event); return }
    if (blocked()) return
    if (event.pointerType === 'touch') event.preventDefault()
    if (isMouseLike(event) && downButton !== -1) {
      heldMask = event.buttons
      const ownerBit = downButton === DOM_BUTTON.left ? LEFT_BIT : RIGHT_BIT
      const otherBit = downButton === DOM_BUTTON.left ? RIGHT_BIT : LEFT_BIT
      // The move's mask is authoritative even when the browser never sent the second
      // `pointerdown`: a drag that gains the opposing bit is the chord (`onPointerMove`).
      if ((event.buttons & otherBit) !== 0) { cancelChord(); return }
      // The owning button went up without a `pointerup` (capture loss, OS gesture): a
      // release nobody made must never commit the gesture, so the press is cancelled.
      if ((event.buttons & ownerBit) === 0) { cancelChord(); return }
    }
    schedule(event)
  }

  const up = (event: PointerEvent): void => {
    if (chordConsumed) { consumeChord(event); return }
    if (event.pointerId !== pointerId) return
    const wasButton = downButton
    const owned = toolOwnsRight
    const travelled = Math.hypot(event.clientX - downX, event.clientY - downY)
    const elapsed = performance.now() - downAt
    // Releasing the **other** button while the press is held cancels it: the classic case
    // is right-up during a left drag, whose own `pointerdown` never fired while the left
    // button was down — committing here would apply the very rectangle the player tried
    // to cancel (`Viewport.tsx` `dispatchPointerUp`).
    if (isMouseLike(event) && wasButton !== -1 && event.button !== wasButton) {
      heldMask = event.buttons
      cancelChord()
      consumeChord(event)
      return
    }
    pointerId = -1
    downButton = -1
    toolOwnsRight = false
    toolPressed = false
    heldMask = event.buttons
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    // The release's hit is the one a click-commit uses, so the queued move is flushed
    // first under the same event order the C# router expects.
    flush()
    if (blocked()) return
    if (wasButton === DOM_BUTTON.right) {
      if (owned) {
        port.send({ type: 'pointer.up', payload: payload(event, DOM_BUTTON.right) })
        return
      }
      if (travelled <= RIGHT_TAP_PX && elapsed <= RIGHT_TAP_MS) port.send({ type: 'pointer.rightTap', payload: payload(event, DOM_BUTTON.right) })
      return
    }
    port.send({ type: 'pointer.up', payload: payload(event, event.button) })
  }

  /**
   * A native menu may arrive at right-down, before a claimed erase drag's release: the
   * drag owns its own context menu (`ownsContextMenu`), so an erase drag keeps its
   * release. Every other menu — the unmatched secondary press the browser reports while
   * the primary is held — is the chord, and cancels the gesture.
   */
  const contextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    const owningErase = downButton === DOM_BUTTON.right && toolOwnsRight && (event.buttons & LEFT_BIT) === 0
    if (owningErase) return
    if (chordConsumed) { heldMask = event.buttons; return }
    if (!toolPressed) return
    cancelChord()
    heldMask = event.buttons
  }

  const cancel = (): void => {
    const hadActivePointer = pointerId >= 0
    const wasChord = chordConsumed
    pointerId = -1
    downButton = -1
    toolOwnsRight = false
    toolPressed = false
    heldMask = 0
    pending = null
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    chordConsumed = false
    if (blocked() && !hadActivePointer) return
    // A chord already told the host to cancel; a second `pointer.cancel` would be noise.
    if (wasChord) return
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
  canvas.addEventListener('contextmenu', contextMenu)
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', cancel)
    canvas.removeEventListener('pointerleave', leave)
    canvas.removeEventListener('contextmenu', contextMenu)
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
