import { FAST_KEY, PLANAR_KEYS, isTypingTarget, planarIntent } from './keyboardNavigation.ts'
import type { ExplodedFloorRow } from '../app/windows/explodedPanelBounds.ts'

export interface ExplodedHostRow extends ExplodedFloorRow {
  packedOffset: number
  manualOffset: [number, number, number]
}

export interface ExplodedHostState {
  generation: number
  sourceRevision: number
  phase: 'closed' | 'loading' | 'ready' | 'error'
  equipped: boolean
  error: string | null
  selectedElevation: number | null
  dragging: boolean
  rows: ExplodedHostRow[]
  panelAnchor: [number, number] | null
  activeGuides: number
}

function asFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseExplodedHostState(raw: unknown): ExplodedHostState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const generation = asFinite(rec.generation) ?? 0
  const sourceRevision = asFinite(rec.sourceRevision) ?? 0
  const phaseRaw = rec.phase
  const phase: ExplodedHostState['phase'] =
    phaseRaw === 'loading' || phaseRaw === 'ready' || phaseRaw === 'error' ? phaseRaw : 'closed'
  const equipped = rec.equipped === true
  const error = typeof rec.error === 'string' && rec.error.length > 0 ? rec.error : null
  const selectedElevation = asFinite(rec.selectedElevation)
  const dragging = rec.dragging === true

  const rows: ExplodedHostRow[] = []
  if (Array.isArray(rec.rows)) {
    for (const item of rec.rows) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const elevation = asFinite(r.elevation)
      if (elevation === null) continue
      const floorVisible = r.floorVisible !== false
      const wallsVisible = r.wallsVisible !== false
      const packedOffset = asFinite(r.packedOffset) ?? 0
      const manual = Array.isArray(r.manualOffset) && r.manualOffset.length >= 3
        ? [
            asFinite(r.manualOffset[0]) ?? 0,
            asFinite(r.manualOffset[1]) ?? 0,
            asFinite(r.manualOffset[2]) ?? 0,
          ] as [number, number, number]
        : [0, 0, 0] as [number, number, number]
      rows.push({ elevation: Math.round(elevation), floorVisible, wallsVisible, packedOffset, manualOffset: manual })
    }
  }

  let panelAnchor: [number, number] | null = null
  if (Array.isArray(rec.panelAnchor) && rec.panelAnchor.length >= 2) {
    const ax = asFinite(rec.panelAnchor[0])
    const ay = asFinite(rec.panelAnchor[1])
    if (ax !== null && ay !== null) panelAnchor = [ax, ay]
  }

  const activeGuides = asFinite(rec.activeGuides) ?? 0
  return {
    generation,
    sourceRevision,
    phase,
    equipped,
    error,
    selectedElevation: selectedElevation === null ? null : Math.round(selectedElevation),
    dragging,
    rows,
    panelAnchor,
    activeGuides,
  }
}

export interface ExplodedCommandPort {
  send(type: string, payload?: Record<string, unknown>): unknown
}

export interface ExplodedInputContext {
  getGeneration(): number
  isReady(): boolean
  isDraggingTray?: () => boolean
  isLocked?: () => boolean
  onClose(): void
  onTogglePlay(): void
}

export interface ExplodedInputSchedule {
  requestFrame?: (cb: () => void) => number
  cancelFrame?: (id: number) => void
}

export interface ExplodedInputController {
  clearTransientState(): void
  flushPendingMoves(): void
  dispose(): void
}

function viewportDimensions(canvas: { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number }; clientWidth?: number; clientHeight?: number }): {
  left: number
  top: number
  width: number
  height: number
} {
  if (typeof canvas.getBoundingClientRect === 'function') {
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1))
    const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1))
    return { left: rect.left || 0, top: rect.top || 0, width, height }
  }
  return {
    left: 0,
    top: 0,
    width: Math.max(1, Math.round(canvas.clientWidth || 1280)),
    height: Math.max(1, Math.round(canvas.clientHeight || 720)),
  }
}

export function attachExplodedInput(
  canvas: HTMLCanvasElement,
  port: ExplodedCommandPort,
  context: ExplodedInputContext,
  schedule: ExplodedInputSchedule = {},
  targets: {
    win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
    doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  } = {},
): ExplodedInputController {
  const reqFrame = schedule.requestFrame ?? (typeof requestAnimationFrame === 'function'
    ? (cb: () => void) => requestAnimationFrame(cb)
    : (cb: () => void) => { cb(); return 0 })
  const cancelFrame = schedule.cancelFrame ?? (typeof cancelAnimationFrame === 'function'
    ? (id: number) => cancelAnimationFrame(id)
    : () => {})
  const win = targets.win ?? (typeof window !== 'undefined' ? window : null)
  const doc = targets.doc ?? (typeof document !== 'undefined' ? document : null)

  let leftDrag: {
    pointerId: number
    generation: number
    lastX: number
    lastY: number
    pendingDx: number
    pendingDy: number
    width: number
    height: number
    rafId: number | null
  } | null = null

  let cameraDrag: {
    mode: 'orbit' | 'pan'
    pointerId: number
    generation: number
    lastX: number
    lastY: number
    pendingDx: number
    pendingDy: number
    width: number
    height: number
    rafId: number | null
  } | null = null

  const heldKeys = new Set<string>()
  let lastPlanarKey = '0|0|0'
  let lastPlanarGeneration = -1

  const sendPlanarIntent = (right: number, forward: number, boost: boolean, gen: number): void => {
    if (gen <= 0) return
    const key = `${right}|${forward}|${boost ? 1 : 0}`
    if (key === lastPlanarKey && gen === lastPlanarGeneration) return
    lastPlanarKey = key
    lastPlanarGeneration = gen
    port.send('exploded.camera', {
      generation: gen,
      op: 'panPlanarHeld',
      right,
      forward,
      boost,
    })
  }

  const clearHeldKeys = (): void => {
    const hadHeld = heldKeys.size > 0 || lastPlanarKey !== '0|0|0'
    heldKeys.clear()
    const gen = context.getGeneration()
    if (hadHeld && context.isReady() && gen > 0) {
      sendPlanarIntent(0, 0, false, gen)
    } else {
      lastPlanarKey = '0|0|0'
    }
  }

  const syncHeldKeys = (): void => {
    const gen = context.getGeneration()
    if (!context.isReady() || gen <= 0 || leftDrag !== null || context.isDraggingTray?.()) {
      clearHeldKeys()
      return
    }
    const intent = planarIntent(heldKeys)
    sendPlanarIntent(intent.right, intent.forward, intent.fast, gen)
  }

  const flushLeftMove = (): void => {
    if (!leftDrag) return
    if (leftDrag.rafId !== null) {
      cancelFrame(leftDrag.rafId)
      leftDrag.rafId = null
    }
    const dx = leftDrag.pendingDx
    const dy = leftDrag.pendingDy
    leftDrag.pendingDx = 0
    leftDrag.pendingDy = 0
    if (dx === 0 && dy === 0) return
    if (!context.isReady() || context.getGeneration() !== leftDrag.generation) return
    port.send('exploded.pointerMove', {
      generation: leftDrag.generation,
      pointerId: leftDrag.pointerId,
      dx,
      dy,
      viewportWidth: leftDrag.width,
      viewportHeight: leftDrag.height,
    })
  }

  const flushCameraMove = (): void => {
    if (!cameraDrag) return
    if (cameraDrag.rafId !== null) {
      cancelFrame(cameraDrag.rafId)
      cameraDrag.rafId = null
    }
    const dx = cameraDrag.pendingDx
    const dy = cameraDrag.pendingDy
    cameraDrag.pendingDx = 0
    cameraDrag.pendingDy = 0
    if (dx === 0 && dy === 0) return
    if (!context.isReady() || context.getGeneration() !== cameraDrag.generation) return
    const payload: Record<string, unknown> = {
      generation: cameraDrag.generation,
      op: cameraDrag.mode,
      dx,
      dy,
      viewportWidth: cameraDrag.width,
      viewportHeight: cameraDrag.height,
    }
    if (cameraDrag.mode === 'orbit') {
      payload.scale = (2 * Math.PI) / Math.max(1, cameraDrag.height)
    }
    port.send('exploded.camera', payload)
  }

  const releaseCaptureSafe = (pointerId: number): void => {
    try {
      if (typeof canvas.hasPointerCapture === 'function' && canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId)
      }
    } catch {
      /* ignore synthetic pointer events without active DOM capture */
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (context.isLocked?.()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const gen = context.getGeneration()
    if (!context.isReady() || gen <= 0) return
    const dims = viewportDimensions(canvas)

    if (event.button === 0) {
      clearHeldKeys()
      const x = event.clientX - dims.left
      const y = event.clientY - dims.top
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      event.preventDefault()
      event.stopPropagation()
      try { canvas.setPointerCapture?.(event.pointerId) } catch { /* synthetic event */ }
      leftDrag = {
        pointerId: event.pointerId,
        generation: gen,
        lastX: event.clientX,
        lastY: event.clientY,
        pendingDx: 0,
        pendingDy: 0,
        width: dims.width,
        height: dims.height,
        rafId: null,
      }
      port.send('exploded.pointerDown', {
        generation: gen,
        pointerId: event.pointerId,
        x,
        y,
        viewportWidth: dims.width,
        viewportHeight: dims.height,
      })
      return
    }

    if (event.button === 1 || event.button === 2) {
      event.preventDefault()
      event.stopPropagation()
      try { canvas.setPointerCapture?.(event.pointerId) } catch { /* synthetic event */ }
      cameraDrag = {
        mode: event.button === 1 ? 'orbit' : 'pan',
        pointerId: event.pointerId,
        generation: gen,
        lastX: event.clientX,
        lastY: event.clientY,
        pendingDx: 0,
        pendingDy: 0,
        width: dims.width,
        height: dims.height,
        rafId: null,
      }
    }
  }

  const handledPointerEvents = new WeakSet<object>()
  const markHandledOnce = (event: PointerEvent): boolean => {
    if (event && typeof event === 'object') {
      if (handledPointerEvents.has(event)) return false
      handledPointerEvents.add(event)
    }
    return true
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (leftDrag && event.pointerId === leftDrag.pointerId) {
      if (!markHandledOnce(event)) return
      if (!context.isReady() || context.getGeneration() !== leftDrag.generation) {
        if (leftDrag.rafId !== null) cancelFrame(leftDrag.rafId)
        leftDrag = null
        return
      }
      const dx = event.clientX - leftDrag.lastX
      const dy = event.clientY - leftDrag.lastY
      leftDrag.lastX = event.clientX
      leftDrag.lastY = event.clientY
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return
      const dims = viewportDimensions(canvas)
      leftDrag.width = dims.width
      leftDrag.height = dims.height
      leftDrag.pendingDx += dx
      leftDrag.pendingDy += dy
      event.preventDefault?.()
      event.stopPropagation?.()
      if (leftDrag.rafId === null) {
        leftDrag.rafId = reqFrame(() => {
          if (leftDrag) leftDrag.rafId = null
          flushLeftMove()
        })
      }
      return
    }

    if (cameraDrag && event.pointerId === cameraDrag.pointerId) {
      if (!markHandledOnce(event)) return
      if (!context.isReady() || context.getGeneration() !== cameraDrag.generation) {
        if (cameraDrag.rafId !== null) cancelFrame(cameraDrag.rafId)
        cameraDrag = null
        return
      }
      const dx = event.clientX - cameraDrag.lastX
      const dy = event.clientY - cameraDrag.lastY
      cameraDrag.lastX = event.clientX
      cameraDrag.lastY = event.clientY
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return
      const dims = viewportDimensions(canvas)
      cameraDrag.width = dims.width
      cameraDrag.height = dims.height
      cameraDrag.pendingDx += dx
      cameraDrag.pendingDy += dy
      event.preventDefault?.()
      event.stopPropagation?.()
      if (cameraDrag.rafId === null) {
        cameraDrag.rafId = reqFrame(() => {
          if (cameraDrag) cameraDrag.rafId = null
          flushCameraMove()
        })
      }
    }
  }

  const finishLeftDrag = (event: PointerEvent, kind: 'exploded.pointerUp' | 'exploded.pointerCancel'): void => {
    if (!leftDrag || event.pointerId !== leftDrag.pointerId) return
    if (!markHandledOnce(event)) return
    event.preventDefault?.()
    event.stopPropagation?.()
    flushLeftMove()
    const { generation, pointerId } = leftDrag
    leftDrag = null
    releaseCaptureSafe(pointerId)
    if (context.isReady() && context.getGeneration() === generation) {
      port.send(kind, { generation, pointerId })
    }
  }

  const finishCameraDrag = (event: PointerEvent): void => {
    if (!cameraDrag || event.pointerId !== cameraDrag.pointerId) return
    if (!markHandledOnce(event)) return
    event.preventDefault?.()
    event.stopPropagation?.()
    flushCameraMove()
    const { pointerId } = cameraDrag
    cameraDrag = null
    releaseCaptureSafe(pointerId)
  }

  const onPointerUp = (event: PointerEvent): void => {
    finishLeftDrag(event, 'exploded.pointerUp')
    finishCameraDrag(event)
  }

  const onPointerCancel = (event: PointerEvent): void => {
    finishLeftDrag(event, 'exploded.pointerCancel')
    finishCameraDrag(event)
  }

  const onWheel = (event: WheelEvent): void => {
    if (context.isLocked?.()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const gen = context.getGeneration()
    if (!context.isReady() || gen <= 0 || !Number.isFinite(event.deltaY)) return
    const dims = viewportDimensions(canvas)
    port.send('exploded.camera', {
      generation: gen,
      op: 'zoom',
      deltaY: event.deltaY,
      viewportWidth: dims.width,
      viewportHeight: dims.height,
    })
  }

  const onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  const onKey = (event: KeyboardEvent): void => {
    if (context.isLocked?.()) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      clearHeldKeys()
      context.onClose()
      return
    }

    const targetEl = event.target as Element | null
    if (targetEl?.closest?.('.explodedFloorPanel, .explodedLevels button') && (event.key === ' ' || event.key === 'Enter')) {
      return
    }
    if (isTypingTarget(event.target)) {
      event.stopImmediatePropagation()
      return
    }

    const key = event.key.toLowerCase()
    if (PLANAR_KEYS.includes(key) || key === FAST_KEY) {
      if (event.type === 'keyup') {
        heldKeys.delete(key)
        syncHeldKeys()
      } else if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        if (leftDrag === null && !context.isDraggingTray?.()) {
          heldKeys.add(key)
          syncHeldKeys()
        }
      }
    }

    if (event.code === 'Space') {
      event.preventDefault()
      if (event.type === 'keydown' && !event.repeat) {
        if ((event.target as HTMLElement | null)?.tagName === 'BUTTON') {
          ;(event.target as HTMLElement).blur()
        }
        context.onTogglePlay()
      }
    }

    event.stopImmediatePropagation()
  }

  const clearTransientState = (): void => {
    if (leftDrag) {
      if (leftDrag.rafId !== null) cancelFrame(leftDrag.rafId)
      const { generation, pointerId } = leftDrag
      leftDrag = null
      releaseCaptureSafe(pointerId)
      if (context.isReady() && context.getGeneration() === generation) {
        port.send('exploded.pointerCancel', { generation, pointerId })
      }
    }
    if (cameraDrag) {
      if (cameraDrag.rafId !== null) cancelFrame(cameraDrag.rafId)
      releaseCaptureSafe(cameraDrag.pointerId)
      cameraDrag = null
    }
    clearHeldKeys()
  }

  const onVisibilityChange = (): void => {
    if (doc?.visibilityState === 'hidden') clearTransientState()
  }

  const onLostPointerCapture = (event: PointerEvent): void => {
    if (!win || (typeof event.buttons === 'number' && event.buttons === 0)) {
      onPointerCancel(event)
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('lostpointercapture', onLostPointerCapture)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('contextmenu', onContextMenu)
  win?.addEventListener('pointermove', onPointerMove as EventListener, true)
  win?.addEventListener('pointerup', onPointerUp as EventListener, true)
  win?.addEventListener('pointercancel', onPointerCancel as EventListener, true)
  win?.addEventListener('keydown', onKey as EventListener, true)
  win?.addEventListener('keyup', onKey as EventListener, true)
  win?.addEventListener('blur', clearTransientState)
  doc?.addEventListener('visibilitychange', onVisibilityChange)

  return {
    clearTransientState,
    flushPendingMoves() {
      flushLeftMove()
      flushCameraMove()
    },
    dispose() {
      clearTransientState()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      win?.removeEventListener('pointermove', onPointerMove as EventListener, true)
      win?.removeEventListener('pointerup', onPointerUp as EventListener, true)
      win?.removeEventListener('pointercancel', onPointerCancel as EventListener, true)
      win?.removeEventListener('keydown', onKey as EventListener, true)
      win?.removeEventListener('keyup', onKey as EventListener, true)
      win?.removeEventListener('blur', clearTransientState)
      doc?.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
