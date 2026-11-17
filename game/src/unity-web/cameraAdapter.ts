// The Unity entry's viewport adapter: the same `ViewCubeAdapter` seam the Three entry
// implements, but over the plan-11 `stationBridge` (v2 envelopes) and the C# camera.
//
// Transport contract (packet D, agreed with the lead):
//
// * C# → JS: a `state` reply carries `payload.camera =
//   { position:[x,y,z], target:[x,y,z], right:[x,y,z], up:[x,y,z], back:[x,y,z],
//     fov, ortho, level }` in **document** axes, with `back = -forward`. The
//   `payload.view` object carries the view toggles. `stationBridge.reduce` spreads
//   both into `snapshot.state`, which is what this adapter reads.
// * JS → C#: `camera.orbit{dx,dy}`, `camera.pan{dx,dy}`, `camera.zoom{delta}`,
//   `camera.snap{face,direction,projection}`, `camera.home{}`, `camera.fov{deg}`,
//   `camera.projection{ortho}`, `camera.panHeld{direction,fast?}`,
//   `camera.panPlanarHeld{right,forward,fast?}` and `view.set{key,value}`. The two
//   held pans are intents, not pixels: the C# rig integrates them per elapsed second
//   (`keyboardNavigation.ts` is the keyboard's holder). None carries
//   `expectedRevision` and none changes the document revision — they are
//   session-scoped camera/view commands.
//
// No Three object is created or read here: the Unity entry must never route its view
// state through a second Three camera.

import type { CubeProjection, CubeVector, CubeViewState, ViewCubeAdapter } from '../app/ViewCubeAdapter.ts'
import { useStore } from '../app/store.ts'
import { stationBridge } from './stationBridge.ts'
import type { StationBridge } from './stationBridge.ts'

/** One camera/view command in the v2 payload vocabulary. */
export type CameraCommand =
  | { type: 'camera.orbit'; payload: { dx: number; dy: number; scale?: number } }
  | { type: 'camera.pan'; payload: { dx: number; dy: number } }
  | { type: 'camera.zoom'; payload: { delta: number } }
  | { type: 'camera.snap'; payload: { face: string; direction: CubeVector; projection: CubeProjection } }
  | { type: 'camera.home'; payload: Record<string, never> }
  | { type: 'camera.fov'; payload: { deg: number } }
  | { type: 'camera.projection'; payload: { ortho: boolean } }
  | { type: 'camera.panHeld'; payload: { direction: -1 | 0 | 1; fast?: boolean } }
  | { type: 'camera.panPlanarHeld'; payload: { right: number; forward: number; fast?: boolean } }
  | { type: 'view.set'; payload: { key: string; value: unknown } }

/** The published camera state, in document axes, plus the eye/aim the C# side sent. */
export interface CameraSnapshot extends CubeViewState {
  position?: CubeVector
  target?: CubeVector
  /** The host's pose sequence; a newer pose is never rolled back by an older state reply. */
  sequence?: number
}

/**
 * The transport seam: what the Unity adapter needs from the bridge, and nothing more.
 * `stationBridge` is the production implementation; a test or another host can pass a
 * recorder instead. `onCameraPose` is the frame-cadence channel (plan 29 §5) and is
 * optional so a minimal recorder can leave it out.
 */
export interface CameraPort {
  send(command: CameraCommand): void
  /** Pushes every accepted camera state (the port coalesces identical snapshots). */
  subscribe(listener: (state: CameraSnapshot) => void): () => void
  /** The host's per-frame pose channel, coalesced to one widget update per animation frame. */
  onCameraPose?(listener: (state: CameraSnapshot) => void): () => void
  dispose(): void
}

/** Convenience constructors for the non-cube camera gestures the canvas needs. */
export const cameraCommands = {
  orbit: (dx: number, dy: number, scale?: number): CameraCommand =>
    ({ type: 'camera.orbit', payload: scale === undefined ? { dx, dy } : { dx, dy, scale } }),
  pan: (dx: number, dy: number): CameraCommand => ({ type: 'camera.pan', payload: { dx, dy } }),
  zoom: (delta: number): CameraCommand => ({ type: 'camera.zoom', payload: { delta } }),
  home: (): CameraCommand => ({ type: 'camera.home', payload: {} }),
  viewSet: (key: string, value: unknown): CameraCommand => ({ type: 'view.set', payload: { key, value } }),
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function vector(value: unknown): CubeVector | null {
  if (Array.isArray(value) && value.length >= 3) {
    const x = finite(value[0]); const y = finite(value[1]); const z = finite(value[2])
    return x === null || y === null || z === null ? null : [x, y, z]
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const x = finite(record.x); const y = finite(record.y); const z = finite(record.z)
    return x === null || y === null || z === null ? null : [x, y, z]
  }
  return null
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
    } catch { return null }
  }
  return null
}

/**
 * Read the camera snapshot out of one `state` payload. Accepts the C# `camera`
 * object (or its JSON text) and, defensively, camera fields merged at the top level.
 * Returns null until the host has published a camera.
 */
export function cameraSnapshotFromState(state: Record<string, unknown> | null | undefined): CameraSnapshot | null {
  if (!state) return null
  const camera = objectOf(state.camera) ?? state
  const right = vector(camera.right)
  const up = vector(camera.up)
  const back = vector(camera.back)
  if (!right || !up || !back) return null
  const fov = finite(camera.fov) ?? finite(state.fov) ?? 45
  const level = finite(camera.level) ?? finite(camera.activeLevel) ?? finite(state.level)
  const ortho = camera.ortho === true || camera.projection === 'orthographic'
  const position = vector(camera.position) ?? undefined
  const target = vector(camera.target) ?? undefined
  const sequence = finite(camera.sequence) ?? finite(state.sequence)
  return {
    right, up, back,
    projection: ortho ? 'orthographic' : 'perspective',
    fov,
    activeLevel: level === null ? undefined : Math.round(level),
    ...(position ? { position } : {}),
    ...(target ? { target } : {}),
    ...(sequence === null ? {} : { sequence: Math.round(sequence) }),
  }
}

function snapshotKey(state: CameraSnapshot): string {
  const basis = [...state.right, ...state.up, ...state.back].map(value => value.toFixed(5)).join(',')
  return `${basis}|${state.projection}|${Math.round(state.fov)}|${state.activeLevel ?? ''}`
}

/**
 * The production port: commands go through `stationBridge.send` (v2 envelope, no
 * `expectedRevision`), camera state is read from `snapshot.state.camera`, and the host's
 * frame-cadence pose channel is consumed **once per animation frame** (plan 29 §5).
 *
 * The reference polls the rendered camera on every animation frame, so a drag's cube
 * follows it frame by frame. The Unity host samples the rendered camera after its own
 * `StationViewRig.Tick` and publishes a small sequenced pose; this port keeps the latest
 * one and hands it to the widget in the next animation frame, which is also the only
 * cadence at which the SVG can be repainted. The general 100 ms state interval still
 * delivers everything else, and an untagged or older state camera never rolls the cube
 * back behind a newer pose.
 */
export function createStationCameraPort(bridge: StationBridge = stationBridge): CameraPort {
  const listeners = new Set<(state: CameraSnapshot) => void>()
  let last = ''
  let lastSequence = -1
  let current: CameraSnapshot | null = null
  let latestPose: CameraSnapshot | null = null
  let poseFrame = 0
  const accept = (state: CameraSnapshot): void => {
    const key = snapshotKey(state)
    if (key === last) return
    last = key
    current = state
    for (const listener of listeners) listener(state)
  }
  const flushPose = (): void => {
    poseFrame = 0
    if (!latestPose) return
    accept(latestPose)
  }
  /** One host pose: keep the newest and let the next animation frame draw it. */
  const onPose = (camera: Record<string, unknown>, sequence: number): void => {
    const state = cameraSnapshotFromState({ camera })
    if (!state) return
    const tagged = sequence >= 0 ? sequence : (state.sequence ?? -1)
    if (tagged >= 0 && tagged < lastSequence) return
    if (tagged >= 0) {
      lastSequence = tagged
      state.sequence = tagged
    }
    latestPose = state
    if (poseFrame) return
    if (typeof requestAnimationFrame === 'function') poseFrame = requestAnimationFrame(flushPose)
    else flushPose()
  }
  const emit = (): void => {
    const raw = bridge.getSnapshot().state
    const state = cameraSnapshotFromState(raw)
    if (!state) return
    const sequence = state.sequence ?? -1
    if (sequence >= 0) {
      if (sequence < lastSequence) return
      lastSequence = sequence
    } else if (lastSequence >= 0) {
      // An untagged camera is older than the pose channel: it cannot supersede a pose.
      return
    }
    accept(state)
  }
  const unsubscribePose = bridge.onCameraPose(onPose)
  const unsubscribeBridge = bridge.subscribe(emit)
  // Ctrl+H is the shell's keyboard route to the same home action as the cube's ⌂
  // (`AppShell` dispatches `metro:home`). The old Unity entry listened for it
  // directly and sent `resetView`; this is that listener, now the camera command.
  const onHome = (): void => { bridge.send('camera.home', {}) }
  if (typeof window !== 'undefined') window.addEventListener('metro:home', onHome)
  emit()
  const subscribe = (listener: (state: CameraSnapshot) => void): (() => void) => {
    listeners.add(listener)
    if (current) listener(current)
    return () => { listeners.delete(listener) }
  }
  return {
    send(command: CameraCommand): void {
      bridge.send(command.type, command.payload)
    },
    subscribe,
    onCameraPose: subscribe,
    dispose(): void {
      if (poseFrame) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(poseFrame); poseFrame = 0 }
      latestPose = null
      if (typeof window !== 'undefined') window.removeEventListener('metro:home', onHome)
      unsubscribePose()
      unsubscribeBridge()
      listeners.clear()
    },
  }
}

/** A lazily created shared port for the mounted player. */
let shared: CameraPort | null = null
export function sharedStationCameraPort(): CameraPort {
  shared ??= createStationCameraPort()
  return shared
}

const FACE_KEYS: Record<string, string> = {
  '1,0,0': 'e', '-1,0,0': 'w', '0,1,0': 'n', '0,-1,0': 's', '0,0,1': 'top', '0,0,-1': 'bottom',
}

/** The cube's action name for a direction; the C# parser prefers `direction` anyway. */
export function snapFaceKey(direction: CubeVector): string {
  const rounded = direction.map(value => (Math.abs(value) < 1e-4 ? 0 : Math.sign(value))).join(',')
  if (FACE_KEYS[rounded]) return FACE_KEYS[rounded]
  return `dir:${direction.map(value => value.toFixed(4)).join(',')}`
}

/** The Unity ViewCube: same drawing/interaction, commands over the bridge. */
export function createUnityViewCubeAdapter(port: CameraPort): ViewCubeAdapter {
  let state: CameraSnapshot | null = null
  let disposed = false
  let held = false
  // A cube drag is accumulated per animation frame (plan 29 §5): the browser can emit
  // several pointer moves per frame, and one orbit command per frame keeps the host's
  // camera loop the cadence the rendered cube follows without dropping any travel.
  let orbitX = 0
  let orbitY = 0
  let orbitFrame = 0
  const stop = port.subscribe(next => { state = next })

  const send = (command: CameraCommand): void => {
    if (disposed) return
    port.send(command)
  }

  const flushOrbit = (): void => {
    orbitFrame = 0
    const dx = orbitX
    const dy = orbitY
    orbitX = 0
    orbitY = 0
    if (dx === 0 && dy === 0) return
    send(cameraCommands.orbit(dx, dy))
  }

  return {
    read(): CubeViewState | null {
      return state
    },
    subscribe(listener): () => void {
      if (state) listener(state)
      return port.subscribe(next => {
        state = next
        listener(next)
      })
    },
    orbit(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
      orbitX += dx
      orbitY += dy
      if (orbitFrame) return
      if (typeof requestAnimationFrame === 'function') orbitFrame = requestAnimationFrame(flushOrbit)
      else flushOrbit()
    },
    snap(direction, projection) {
      send({ type: 'camera.snap', payload: { face: snapFaceKey(direction), direction, projection } })
    },
    home() {
      send(cameraCommands.home())
    },
    setProjection(projection) {
      send({ type: 'camera.projection', payload: { ortho: projection === 'orthographic' } })
    },
    setFov(deg) {
      if (!Number.isFinite(deg)) return
      send({ type: 'camera.fov', payload: { deg } })
    },
    beginHeldPan(direction) {
      held = true
      send({ type: 'camera.panHeld', payload: { direction } })
    },
    updateHeldPan() {
      // The C# camera integrates the held vertical pan in its own Update; each frame
      // here would only flood the bridge for a value the host already owns.
    },
    endHeldPan() {
      if (!held) return
      held = false
      send({ type: 'camera.panHeld', payload: { direction: 0 } })
    },
    dispose() {
      if (disposed) return
      if (held) send({ type: 'camera.panHeld', payload: { direction: 0 } })
      held = false
      if (orbitFrame) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(orbitFrame)
        orbitFrame = 0
      }
      orbitX = 0
      orbitY = 0
      disposed = true
      stop()
    },
  }
}

/**
 * Bridge the shared view toggles (视图 folder, section controls, Hide UI, exploded,
 * overlays) to the C# view. The store's defaults match C#'s, so only a *change* is
 * sent; `main.tsx` already forwards `activeZ`, which is the one view key with its own
 * owner. This is one line in the player mount; without it the toolbar still changes
 * only React state.
 *
 * It is deliberately not installed by `createStationCameraPort`: a test or another
 * host may create a port without a mounted shared store.
 */
export function attachViewStateBridge(port: CameraPort, options: { forwardExploded?: boolean } = {}): () => void {
  const forwardExploded = options.forwardExploded !== false
  let previous = useStore.getState()
  const send = (key: string, value: unknown): void => port.send({ type: 'view.set', payload: { key, value } })
  const apply = (state: typeof previous): void => {
    const now = state
    if (now.ghostOtherLevels !== previous.ghostOtherLevels) send('showLevels', now.ghostOtherLevels)
    if (now.autoCeiling !== previous.autoCeiling) send('ceiling', now.autoCeiling)
    if (now.hideWalls !== previous.hideWalls) send('walls', now.hideWalls)
    if (now.hideGround !== previous.hideGround) send('ground', now.hideGround)
    if (now.hideRoof !== previous.hideRoof) send('roof', now.hideRoof)
    if (now.hideUI !== previous.hideUI) send('hideUi', now.hideUI)
    if (now.cutaway !== previous.cutaway) send('cutaway', now.cutaway)
    if (now.hideSectionSurface !== previous.hideSectionSurface) send('sectionSurface', !now.hideSectionSurface)
    if (forwardExploded && now.explodedView !== previous.explodedView) send('exploded', now.explodedView)
    if (now.overlayOn !== previous.overlayOn) send('density', now.overlayOn)
    if (now.zoneOverlayOn !== previous.zoneOverlayOn) send('zones', now.zoneOverlayOn)
    if (now.followAgentId !== previous.followAgentId) send('followPassenger', now.followAgentId ?? null)
    if (now.section !== previous.section) {
      const anchorChanged = now.section.anchor.some((value, axis) => value !== previous.section.anchor[axis])
      const rotated = now.section.orientation.azimuth !== previous.section.orientation.azimuth
      // Unity seeds the station anchor itself. A rotation only carries the new
      // angle, so the shell's initial placeholder cannot move the cut to the origin.
      if (anchorChanged) send('sectionAnchor', now.section.anchor)
      if (rotated) send('sectionRotate', now.section.orientation.azimuth)
      else if (now.section.offset !== previous.section.offset) send('sectionOffset', now.section.offset)
    }
    previous = now
  }
  return useStore.subscribe(apply)
}

/**
 * Canvas camera gestures for the Unity entry: middle drag orbits, right drag pans,
 * the wheel zooms, and a context menu is suppressed. It listens on the canvas only, so
 * a drag that starts on the ViewCube or any React panel never reaches it — the two
 * input owners cannot both consume the same gesture.
 *
 * The lead mounts this from `main.tsx`; the C# host must not also read the mouse for
 * the camera while it is attached.
 */
export function attachCanvasCameraGestures(
  canvas: HTMLCanvasElement,
  port: CameraPort,
  options: { blocked?: () => boolean; claimsRight?: () => boolean } = {},
): () => void {
  let mode: 'orbit' | 'pan' | null = null
  let pointer = -1
  let button = -1
  let x = 0
  let y = 0
  const isBlocked = (): boolean => {
    try { return options.blocked ? options.blocked() : false } catch { return false }
  }
  /**
   * Arbitration (plan 27 §2): a tool gesture that claims the secondary button is the one
   * owner of a right press. The camera adapter still owns middle orbit and every right drag
   * the tool does not claim, so the same event never pans and digs.
   */
  const claimsRight = (): boolean => {
    try { return options.claimsRight ? options.claimsRight() : false } catch { return false }
  }
  /**
   * Chord cancellation (plan 29 §2). A press of the other build button while this one is
   * held cancels both gestures; the camera must never start a pan from the second press of
   * a chord, and a right pan whose left button appears — or whose release is unmatched —
   * stops where it is. The tool pointer stream applies the same rule to its own half.
   */
  const cancel = (): void => {
    mode = null
    pointer = -1
    button = -1
  }
  const opposingHeld = (event: PointerEvent, held: number): boolean =>
    held === 2 ? (event.buttons & 1) !== 0 : (event.buttons & 2) !== 0

  const down = (event: PointerEvent): void => {
    if (isBlocked()) return
    if (event.button !== 1 && event.button !== 2) return
    if (event.button === 2 && claimsRight()) return
    // The second press of a chord is not a camera gesture.
    if ((event.buttons & (event.button === 2 ? 1 : 2)) !== 0) return
    mode = event.button === 1 ? 'orbit' : 'pan'
    button = event.button
    pointer = event.pointerId
    x = event.clientX
    y = event.clientY
    event.preventDefault()
    try { canvas.setPointerCapture(event.pointerId) } catch { /* the drag still works inside the canvas */ }
  }
  const move = (event: PointerEvent): void => {
    if (!mode || event.pointerId !== pointer) return
    if (isBlocked()) {
      cancel()
      return
    }
    if (opposingHeld(event, button)) {
      cancel()
      return
    }
    if ((event.buttons & button) === 0) {
      // The owning button went up without an `up` reaching the canvas: never keep panning.
      cancel()
      return
    }
    const dx = event.clientX - x
    const dy = event.clientY - y
    x = event.clientX
    y = event.clientY
    if (dx === 0 && dy === 0) return
    event.preventDefault()
    if (mode === 'orbit') {
      // OrbitControls' own feel: a full viewport height is a full turn. The cube's
      // drag keeps the camera system's 0.008 rad/px rate.
      const scale = 2 * Math.PI / Math.max(1, canvas.clientHeight)
      port.send(cameraCommands.orbit(dx, dy, scale))
    } else {
      port.send(cameraCommands.pan(dx, dy))
    }
  }
  const up = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return
    // Releasing the other build button while this one is held cancels the gesture.
    if (button !== -1 && (event.button === 0 || event.button === 2) && event.button !== button) {
      cancel()
      return
    }
    cancel()
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }
  const wheel = (event: WheelEvent): void => {
    if (isBlocked()) return
    event.preventDefault()
    port.send(cameraCommands.zoom(event.deltaY))
  }
  const context = (event: Event): void => event.preventDefault()

  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('lostpointercapture', up)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('contextmenu', context)
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', up)
    canvas.removeEventListener('lostpointercapture', up)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('contextmenu', context)
  }
}
