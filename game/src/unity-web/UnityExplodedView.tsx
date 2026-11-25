import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { showGameLoading } from '../app/gameLoading.ts'
import { useStore } from '../app/store.ts'
import { getUiTheme, subscribeUiTheme } from '../app/uiTheme.ts'
import { getUiScale } from '../app/uiScale.ts'
import {
  ExplodedViewShell,
  clampExplodedFloorPanelPosition,
} from '../app/windows/ExplodedViewShell.tsx'
import {
  attachExplodedInput,
  parseExplodedHostState,
  type ExplodedHostRow,
  type ExplodedHostState,
  type ExplodedInputController,
} from './explodedInput.ts'
import { stationBridge } from './stationBridge.ts'

export { parseExplodedHostState, type ExplodedHostRow, type ExplodedHostState }

export function UnityExplodedView({ canvas }: { canvas: HTMLCanvasElement }): React.ReactElement | null {
  const open = useStore(s => s.explodedView)
  const snapshot = useSyncExternalStore(stationBridge.subscribe, stationBridge.getSnapshot)
  const hostState = useMemo(() => parseExplodedHostState(snapshot.state.exploded), [snapshot.state.exploded])
  const lastHandledGenRef = useRef<number>(hostState?.generation ?? 0)
  const externalGenRef = useRef<number | null>(null)

  useEffect(() => {
    if (open || !hostState) return
    if (
      (hostState.phase === 'loading' || hostState.phase === 'ready')
      && hostState.generation > lastHandledGenRef.current
    ) {
      lastHandledGenRef.current = hostState.generation
      externalGenRef.current = hostState.generation
      useStore.getState().setExplodedView(true)
    }
  }, [open, hostState])

  return open
    ? (
        <UnityExplodedModal
          canvas={canvas}
          hostState={hostState}
          lastHandledGenRef={lastHandledGenRef}
          externalGenRef={externalGenRef}
        />
      )
    : null
}

function UnityExplodedModal({
  canvas,
  hostState,
  lastHandledGenRef,
  externalGenRef,
}: {
  canvas: HTMLCanvasElement
  hostState: ExplodedHostState | null
  lastHandledGenRef: React.MutableRefObject<number>
  externalGenRef: React.MutableRefObject<number | null>
}): React.ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const floorPanelRef = useRef<HTMLElement>(null)
  const initialExternalGen = useRef<number | null>(externalGenRef.current)
  const baselineGenRef = useRef<number>(
    initialExternalGen.current !== null
      ? initialExternalGen.current - 1
      : (parseExplodedHostState(stationBridge.getSnapshot().state.exploded)?.generation ?? 0),
  )
  const adoptedGenRef = useRef<number>(initialExternalGen.current ?? 0)
  const closingRef = useRef(false)
  const inputRef = useRef<ExplodedInputController | null>(null)

  const currentSessionState = hostState && hostState.generation > baselineGenRef.current ? hostState : null
  if (currentSessionState && currentSessionState.generation > adoptedGenRef.current) {
    adoptedGenRef.current = currentSessionState.generation
  }
  if (adoptedGenRef.current > lastHandledGenRef.current) {
    lastHandledGenRef.current = adoptedGenRef.current
  }

  const activeGeneration = currentSessionState?.generation ?? 0
  const ready = currentSessionState?.phase === 'ready'
  const equipped = currentSessionState?.equipped === true
  const error = currentSessionState?.error ?? null
  const rows = currentSessionState?.rows ?? []
  const selectedIndex = useMemo(() => {
    if (!currentSessionState || currentSessionState.selectedElevation === null) return null
    const idx = currentSessionState.rows.findIndex(r => r.elevation === currentSessionState.selectedElevation)
    return idx >= 0 ? idx : null
  }, [currentSessionState])

  // Keep live state refs for synchronous input callbacks
  const liveRef = useRef({ generation: activeGeneration, ready, dragging: currentSessionState?.dragging === true })
  liveRef.current = { generation: activeGeneration, ready, dragging: currentSessionState?.dragging === true }

  const closeFromUi = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    inputRef.current?.clearTransientState()
    const gen = adoptedGenRef.current || liveRef.current.generation
    stationBridge.send('exploded.close', gen > 0 ? { generation: gen } : {})
    useStore.getState().setExplodedView(false)
  }, [])

  // If C# closes our active session externally (e.g. a station switch via BeforePreviousDispose),
  // mirror that transition to the store without sending a redundant close command.
  useEffect(() => {
    if (closingRef.current) return
    if (adoptedGenRef.current > 0 && currentSessionState?.phase === 'closed') {
      closingRef.current = true
      inputRef.current?.clearTransientState()
      useStore.getState().setExplodedView(false)
    }
  }, [currentSessionState?.phase])

  // Toggle arrange cursor class on the reparented canvas without clobbering its base classes
  useEffect(() => {
    if (selectedIndex !== null) canvas.classList.add('explodedArrangeCanvas')
    else canvas.classList.remove('explodedArrangeCanvas')
    return () => { canvas.classList.remove('explodedArrangeCanvas') }
  }, [canvas, selectedIndex])

  // Position floating .explodedFloorPanel from C#'s normalized 8-corner anchor
  useLayoutEffect(() => {
    const panel = floorPanelRef.current
    const modal = dialogRef.current
    const anchor = currentSessionState?.panelAnchor ?? null
    if (!panel || !modal || !anchor || selectedIndex === null) return
    const width = canvas.clientWidth || modal.clientWidth || window.innerWidth || 1280
    const height = canvas.clientHeight || modal.clientHeight || window.innerHeight || 720
    const toolbarBottom = modal.querySelector('.explodedToolbar')?.getBoundingClientRect().height ?? 56
    const footerHeight = modal.querySelector('.explodedLevels')?.getBoundingClientRect().height ?? 44
    const usableHeight = Math.max(80, height - toolbarBottom - footerHeight)
    const scale = getUiScale()
    const panelRect = panel.getBoundingClientRect()
    const clamped = clampExplodedFloorPanelPosition(
      [anchor[0] * width, anchor[1] * height],
      panelRect.width || (panel.offsetWidth || 180) * scale,
      panelRect.height || (panel.offsetHeight || 76) * scale,
      { left: 0, top: toolbarBottom, width, height: usableHeight },
    )
    panel.style.left = `${clamped.left / scale}px`
    panel.style.top = `${clamped.top / scale}px`
  }, [canvas, currentSessionState?.panelAnchor, selectedIndex])

  // Modal lifecycle: showModal, reparent #unity-canvas in/out, bind input, and send exploded.open / close
  useLayoutEffect(() => {
    const modal = dialogRef.current
    if (!modal) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousParent = canvas.parentElement
    const previousNextSibling = canvas.nextSibling

    modal.showModal()
    showGameLoading(false)
    modal.insertBefore(canvas, modal.firstChild)

    const inputController = attachExplodedInput(canvas, stationBridge, {
      getGeneration: () => liveRef.current.generation,
      isReady: () => liveRef.current.ready,
      isDraggingTray: () => liveRef.current.dragging,
      isLocked: () => document.body.dataset.metroBenchmarkLocked === 'true',
      onClose: closeFromUi,
      onTogglePlay: () => {
        const st = useStore.getState()
        st.setPlaying(!st.playing)
      },
    })
    inputRef.current = inputController

    const unsubscribeTheme = subscribeUiTheme(() => {
      if (!closingRef.current) {
        stationBridge.send('exploded.theme', { theme: getUiTheme() })
      }
    })

    let lastSentW = 0
    let lastSentH = 0
    const notifyResize = (): void => {
      if (closingRef.current || !liveRef.current.ready || liveRef.current.generation <= 0) return
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || window.innerWidth || 1280))
      const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || window.innerHeight || 720))
      if (w === lastSentW && h === lastSentH) return
      lastSentW = w
      lastSentH = h
      stationBridge.send('exploded.camera', {
        generation: liveRef.current.generation,
        op: 'resize',
        viewportWidth: w,
        viewportHeight: h,
      })
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(notifyResize) : null
    observer?.observe(canvas)
    window.addEventListener('resize', notifyResize)

    // Let the loading dialog paint one frame before triggering structural tray build
    const openedExternally = initialExternalGen.current !== null
    externalGenRef.current = null
    const openFrame = openedExternally
      ? 0
      : requestAnimationFrame(() => {
          if (closingRef.current) return
          const rect = canvas.getBoundingClientRect()
          const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || window.innerWidth || 1280))
          const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || window.innerHeight || 720))
          lastSentW = w
          lastSentH = h
          stationBridge.send('exploded.open', {
            viewportWidth: w,
            viewportHeight: h,
            theme: getUiTheme(),
          })
        })

    return () => {
      if (openFrame) cancelAnimationFrame(openFrame)
      window.removeEventListener('resize', notifyResize)
      observer?.disconnect()
      unsubscribeTheme()
      inputController.dispose()
      inputRef.current = null

      if (!closingRef.current) {
        closingRef.current = true
        const gen = adoptedGenRef.current || liveRef.current.generation
        stationBridge.send('exploded.close', gen > 0 ? { generation: gen } : {})
      }

      // Restore #unity-canvas to .unityViewport without recreating or resizing it
      const fallbackStage = document.querySelector('.unityViewport')
      const targetParent = previousParent && previousParent.isConnected ? previousParent : fallbackStage
      if (targetParent) {
        if (previousNextSibling && previousNextSibling.parentNode === targetParent) {
          targetParent.insertBefore(canvas, previousNextSibling)
        } else {
          targetParent.insertBefore(canvas, targetParent.firstChild)
        }
      }

      if (modal.open) modal.close()
      previousFocus?.focus?.()
    }
  }, [canvas, closeFromUi])

  const handleSelectIndex = useCallback((index: number | null) => {
    const gen = liveRef.current.generation
    if (!liveRef.current.ready || gen <= 0) return
    const elevation = index !== null && index >= 0 && index < rows.length ? rows[index].elevation : null
    if (elevation === (currentSessionState?.selectedElevation ?? null)) return
    stationBridge.send('exploded.select', { generation: gen, elevation })
  }, [currentSessionState?.selectedElevation, rows])

  const handleToggleFloor = useCallback((index: number) => {
    const gen = liveRef.current.generation
    const row = rows[index]
    if (!liveRef.current.ready || gen <= 0 || !row) return
    stationBridge.send('exploded.floorVisibility', {
      generation: gen,
      elevation: row.elevation,
      floorVisible: !row.floorVisible,
    })
  }, [rows])

  const handleToggleWalls = useCallback((index: number) => {
    const gen = liveRef.current.generation
    const row = rows[index]
    if (!liveRef.current.ready || gen <= 0 || !row) return
    stationBridge.send('exploded.floorVisibility', {
      generation: gen,
      elevation: row.elevation,
      wallsVisible: !row.wallsVisible,
    })
  }, [rows])

  const handleReset = useCallback(() => {
    const gen = liveRef.current.generation
    if (!liveRef.current.ready || gen <= 0) return
    stationBridge.send('exploded.reset', { generation: gen })
  }, [])

  return (
    <ExplodedViewShell
      dialogRef={dialogRef}
      floorPanelRef={floorPanelRef}
      ready={ready}
      equipped={equipped}
      unityHost
      error={error}
      rows={rows}
      selectedIndex={selectedIndex}
      onClose={closeFromUi}
      onReset={handleReset}
      onSelectIndex={handleSelectIndex}
      onToggleFloor={handleToggleFloor}
      onToggleWalls={handleToggleWalls}
      isCanvasTarget={target => target === canvas}
    >
      <div className="explodedCanvasSpacer" aria-hidden="true" />
    </ExplodedViewShell>
  )
}
