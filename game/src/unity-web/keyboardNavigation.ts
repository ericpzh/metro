// The Unity entry's keyboard navigation (plan 13 §1).
//
// `app/Viewport.tsx` owns WASD and Ctrl+Q/E for the Three.js entry, where the camera
// rig reads the key set itself (`CameraSystem.panCamera`/`panCameraVertical`). The
// Unity entry has no such rig in the page: C# owns the camera (`StationCameraController`),
// so a held key becomes a *held intent* on the bridge —
//
//   camera.panPlanarHeld { right, forward, fast }   the WASD ground pan
//   camera.panHeld       { direction, fast }        the Ctrl+Q/E vertical pan
//
// and the C# rig integrates it per elapsed second at the same `moveSpeed` and with the
// same camera-and-aim translation as the source. Only a change is sent: a key that
// repeats every frame would flood the bridge for a value the host already owns.
//
// **What stays the shell's.** Space (play/pause), plain Q/E (storey step), Ctrl+H
// (home), R, the tool letters and every other shortcut belong to `AppShell`'s one
// key handler. This module deliberately owns only the two keys the Three *scene*
// owns, so a Unity player cannot end up with two handlers for one key.
//
// **Held state is cleared** on keyup, on a modifier release, on window blur, on a
// hidden tab, while a dialog owns the keyboard, and on unmount. A held pan that
// survives losing focus would keep the camera moving with nobody holding it.
import type { CameraCommand, CameraPort } from './cameraAdapter.ts'

/** The keys the ground pan holds, exactly as `Viewport.tsx`'s `panKeys` (minus shift). */
export const PLANAR_KEYS: readonly string[] = ['w', 'a', 's', 'd']

/** The Shift accelerator's key name in the held set. */
export const FAST_KEY = 'shift'

/**
 * The intent a held key set describes. `forward` is +1 for W, `right` +1 for D — the
 * same axes `CameraSystem.panInput` produces, clamped by the C# side.
 */
export function planarIntent(held: ReadonlySet<string>): { right: number; forward: number; fast: boolean } {
  let forward = 0
  let right = 0
  if (held.has('w')) forward += 1
  if (held.has('s')) forward -= 1
  if (held.has('d')) right += 1
  if (held.has('a')) right -= 1
  return { right, forward, fast: held.has(FAST_KEY) }
}

/**
 * The same predicate `app/Viewport.tsx` exports (re-stated here so this module stays
 * importable without the Three.js scene, which the Unity UI bundle stubs out anyway).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
}

/** The subset of `window`/`document` this module listens on (so a test can fake it). */
export interface KeyboardNavigationTarget {
  addEventListener(type: string, listener: (event: KeyboardEvent) => void): void
  removeEventListener(type: string, listener: (event: KeyboardEvent) => void): void
}

export interface KeyboardNavigationOptions {
  /** The shell's own veto: an open sign editor, a dialog, a benchmark lock, … */
  blocked?: () => boolean
  /** Where key events arrive; defaults to the window the player is mounted in. */
  keyTarget?: KeyboardNavigationTarget
  /** Where blur/visibility arrive; defaults to the same window. */
  hostTarget?: KeyboardNavigationTarget & { document?: { addEventListener?: KeyboardNavigationTarget['addEventListener']; removeEventListener?: KeyboardNavigationTarget['removeEventListener'] } }
}

/**
 * Attach the held-pan keyboard route. Returns the detach: it clears any held intent
 * first, so a disposed player never leaves the C# camera drifting.
 */
export function attachKeyboardNavigation(port: CameraPort, options: KeyboardNavigationOptions = {}): () => void {
  const keyTarget = options.keyTarget ?? (typeof window !== 'undefined' ? window : null)
  const hostTarget = options.hostTarget ?? (typeof window !== 'undefined' ? window : null)
  if (!keyTarget) return () => {}
  const docTarget = options.hostTarget?.document ?? (typeof document !== 'undefined' ? document : null)
  const held = new Set<string>()
  let planarIntentKey = ''
  let verticalIntentKey = ''

  const send = (command: CameraCommand): void => port.send(command)

  const publishPlanar = (): void => {
    const intent = planarIntent(held)
    const key = `${intent.right}|${intent.forward}|${intent.fast ? 1 : 0}`
    if (key === planarIntentKey) return
    planarIntentKey = key
    send({ type: 'camera.panPlanarHeld', payload: { right: intent.right, forward: intent.forward, fast: intent.fast } })
  }
  const publishVertical = (): void => {
    const vertical = Number(held.has('e')) - Number(held.has('q'))
    const fast = held.has(FAST_KEY)
    const key = `${vertical}|${fast ? 1 : 0}`
    if (key === verticalIntentKey) return
    verticalIntentKey = key
    send({ type: 'camera.panHeld', payload: { direction: vertical as -1 | 0 | 1, fast } })
  }
  const clear = (): void => {
    const wasPlanar = planarIntentKey !== '' && planarIntentKey !== '0|0|0' && planarIntentKey !== '0|0|1'
    const wasVertical = verticalIntentKey !== '' && verticalIntentKey !== '0|0' && verticalIntentKey !== '0|1'
    held.clear()
    if (wasPlanar) {
      planarIntentKey = '0|0|0'
      send({ type: 'camera.panPlanarHeld', payload: { right: 0, forward: 0, fast: false } })
    }
    if (wasVertical) {
      verticalIntentKey = '0|0'
      send({ type: 'camera.panHeld', payload: { direction: 0, fast: false } })
    }
  }
  const isBlocked = (): boolean => {
    try { return options.blocked ? options.blocked() : false } catch { return false }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isBlocked() || isTypingTarget(event.target)) return
    const key = event.key.toLowerCase()
    if (event.altKey) return
    const control = event.ctrlKey || event.metaKey
    // Ctrl+Q / Ctrl+E is the vertical pan, the one camera pair that needs a modifier:
    // a plain Q/E is the storey step and belongs to `AppShell`.
    if (control && (key === 'q' || key === 'e')) {
      event.preventDefault()
      held.add(key)
      publishVertical()
      return
    }
    if (key === FAST_KEY) {
      if (held.has(FAST_KEY)) return
      held.add(FAST_KEY)
      publishPlanar()
      if (held.has('q') || held.has('e')) publishVertical()
      return
    }
    if (control) return
    if (PLANAR_KEYS.includes(key)) {
      if (held.has(key)) return
      held.add(key)
      publishPlanar()
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase()
    // Clear the vertical holds when the last Ctrl/Meta modifier is released.
    if (key === 'control' || key === 'meta') {
      if (!event.ctrlKey && !event.metaKey) {
        const releasedUp = held.delete('e')
        const releasedDown = held.delete('q')
        if (releasedUp || releasedDown) publishVertical()
      }
      return
    }
    if (key === FAST_KEY) {
      if (!held.delete(FAST_KEY)) return
      publishPlanar()
      if (held.has('q') || held.has('e')) publishVertical()
      return
    }
    if (!held.delete(key)) return
    if (key === 'q' || key === 'e') publishVertical()
    else publishPlanar()
  }

  // Focus loss is not optional: a key the page never sees released must not keep the
  // camera moving. `blur` covers alt-tab; `visibilitychange` covers a hidden tab,
  // which does not always blur first.
  const onBlur = (): void => clear()
  const onVisibility = (event?: Event): void => {
    // The event carries the new state; a listener bound to another document (a test)
    // must not read the global one.
    const state = (event as (Event & { visibilityState?: string }) | undefined)?.visibilityState
      ?? (typeof document !== 'undefined' ? document.visibilityState : undefined)
    if (state === 'hidden') clear()
  }

  keyTarget.addEventListener('keydown', onKeyDown)
  keyTarget.addEventListener('keyup', onKeyUp)
  hostTarget?.addEventListener('blur', onBlur)
  docTarget?.addEventListener?.('visibilitychange', onVisibility)
  return () => {
    clear()
    keyTarget.removeEventListener('keydown', onKeyDown)
    keyTarget.removeEventListener('keyup', onKeyUp)
    hostTarget?.removeEventListener('blur', onBlur)
    docTarget?.removeEventListener?.('visibilitychange', onVisibility)
  }
}
