import { gameAudio } from '../gameAudio.ts'
import { showGameLoading } from '../gameLoading.ts'
import { getAudioVolumes, subscribeAudioVolumes } from '../audioSettings.ts'
import { getUiTheme, subscribeUiTheme, themeVoidColor } from '../uiTheme.ts'
import { getUiScale } from '../uiScale.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toData } from '../../build/model.ts'
import { explodedView, explodedPoses, explodedLiftPoses } from '../../render/explodedView.ts'
import { explodedPassengerSupport, filterExplodedPassengers } from '../../render/explodedPassengers.ts'
import { trainOriginForScale, trainScaleForStorey } from '../../sim/stock.ts'
import { SceneRenderer } from '../../render/scene.ts'
import { t } from '../../sim/i18n.ts'
import { useLanguage } from '../i18n.ts'
import { useStore } from '../store.ts'
import { subscribeFrame } from '../store/slices/SimSlice.ts'
import {
  ExplodedLoading,
  ExplodedViewShell,
  clampExplodedFloorPanelPosition,
  type ExplodedFloorRow,
} from './ExplodedViewShell.tsx'

export function ExplodedView(): React.ReactElement | null {
  const open = useStore(s => s.explodedView)
  return open ? <Viewer /> : null
}

type Snapshot = ReturnType<typeof explodedView> & { source: ReturnType<typeof toData> }

function Viewer(): React.ReactElement {
  useLanguage()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const closing = useRef(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (closing.current) return
        const source = toData(useStore.getState().station)
        setSnapshot({ ...explodedView(source), source })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return snapshot ? <PreparedViewer snapshot={snapshot} /> : <LoadingViewer onReturn={modal => {
    if (closing.current) return
    closing.current = true
    returnToEditor(modal)
  }} />
}

function returnToEditor(modal: HTMLDialogElement | null): void {
  const title = document.getElementById('loading-title')
  const detail = document.getElementById('loading-detail')
  const english = document.documentElement.lang === 'en'
  if (title) title.textContent = english ? 'Returning to your station' : '正在返回车站'
  if (detail) detail.textContent = english ? 'Rebuilding the editor. Please wait.' : '正在重新构建编辑器，请稍候。'
  modal?.close()
  showGameLoading(true)
  requestAnimationFrame(() => requestAnimationFrame(() => useStore.getState().setExplodedView(false)))
}

function LoadingViewer({ onReturn }: { onReturn: (modal: HTMLDialogElement | null) => void }): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    dialog.current?.showModal()
    showGameLoading(false)
  }, [])
  return (
    <dialog
      ref={dialog}
      className="explodedViewer"
      aria-label={t('exploded_view')}
      onCancel={event => {
        event.preventDefault()
        onReturn(dialog.current)
      }}
    >
      <ExplodedLoading />
    </dialog>
  )
}

function PreparedViewer({ snapshot }: { snapshot: Snapshot }): React.ReactElement {
  useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<SceneRenderer | null>(null)
  const floorPanel = useRef<HTMLElement>(null)
  const [ready, setReady] = useState(false)
  const [equipped, setEquipped] = useState(false)
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; floor: number } | null>(null)
  const playing = useStore(s => s.playing)
  const speed = useStore(s => s.speed)
  const upscalingMode = useStore(s => s.upscalingMode)
  useEffect(() => { renderer.current?.setPlaying(playing) }, [playing])
  useEffect(() => { if (renderer.current) renderer.current.audioSpeed = speed }, [speed])
  useEffect(() => { renderer.current?.setUpscalingMode(upscalingMode) }, [upscalingMode])
  const visibilityRef = useRef(snapshot.levels.map(() => ({floor:true,walls:true})))
  const [visibility, setVisibility] = useState(visibilityRef.current)
  const selectFloor = (index: number | null): void => {
    renderer.current?.selectExplodedFloor(index)
    setSelectedFloor(index)
  }
  const toggleVisibility = (index: number, part: 'floor' | 'walls'): void => {
    const next = visibilityRef.current.map((value, i) => (i === index ? { ...value, [part]: !value[part] } : value))
    visibilityRef.current = next
    setVisibility(next)
    renderer.current?.setExplodedFloorVisibility(index, next[index].floor, next[index].walls)
  }
  useLayoutEffect(() => {
    const scene = renderer.current
    if (!scene || selectedFloor === null) return
    scene.onExplodedFloorAnchor = point => {
      const panel = floorPanel.current
      const view = canvas.current
      if (!panel || !view) return
      const scale = getUiScale()
      const panelRect = panel.getBoundingClientRect()
      const clamped = clampExplodedFloorPanelPosition(
        [point[0], view.offsetTop + point[1]],
        panelRect.width || panel.offsetWidth * scale,
        panelRect.height || panel.offsetHeight * scale,
        { left: 0, top: view.offsetTop, width: view.clientWidth, height: view.clientHeight },
      )
      panel.style.left = `${clamped.left / scale}px`
      panel.style.top = `${clamped.top / scale}px`
    }
    const point = scene.getExplodedFloorAnchor()
    if (point) scene.onExplodedFloorAnchor(point)
    scene.requestRender()
    return () => { scene.onExplodedFloorAnchor = null }
  }, [selectedFloor])
  const closing = useRef(false)
  const close = (): void => {
    if (closing.current) return
    closing.current = true
    returnToEditor(dialog.current)
  }
  useLayoutEffect(() => {
    const modal = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    modal.showModal()
    const onKey = (event: KeyboardEvent): void => {
      if (document.body.dataset.metroBenchmarkLocked === 'true') {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
      const key = event.key.toLowerCase()
      if ((event.target as Element)?.closest?.('.explodedFloorPanel, .explodedLevels button') && [' ', 'Enter'].includes(event.key)) return
      if (['w', 'a', 's', 'd', 'shift'].includes(key)) {
        if (event.type === 'keyup') renderer.current?.keys.delete(key)
        else if (!event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          renderer.current?.keys.add(key)
        }
      }
      if (event.code === 'Space') {
        event.preventDefault()
        if (event.type === 'keydown' && !event.repeat) {
          const state = useStore.getState()
          state.setPlaying(!state.playing)
        }
      }
      // The editor has window-level shortcuts, including key-up camera state.
      // Tab keeps its native dialog focus navigation.
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    let observer: ResizeObserver | undefined
    let unsubscribe: (() => void) | undefined
    let unsubscribeAudio: (() => void) | undefined
    let unsubscribeTheme: (() => void) | undefined
    const onBlur = (): void => { renderer.current?.keys.clear() }
    window.addEventListener('blur', onBlur)
    // Let the modal and loading state paint before preparing a large station.
    let cancelled = false
    let equipmentTimer: number | undefined
    let simulationTimer: number | undefined
    const timer = window.setTimeout(() => {
      if (snapshot.levels.length === 0) { setReady(true); setEquipped(true); return }
      const scene = new SceneRenderer(canvas.current!)
      renderer.current = scene
      window.__benchmarkScene = scene
      const updateAudio = (): void => {
        const volumes = getAudioVolumes()
        scene.onAudioFrame = volumes.master > 0 && volumes.ambient > 0
          ? frame => gameAudio.updateScene({ ...frame, speed: useStore.getState().speed })
          : null
      }
      updateAudio()
      unsubscribeAudio = subscribeAudioVolumes(updateAudio)
      scene.setStandalonePresentation()
      const updateVoid = (): void => {
        const theme = getUiTheme()
        scene.setVoidColor(themeVoidColor(theme), theme === 'studio' ? themeVoidColor(theme) : 0x192532)
      }
      updateVoid()
      unsubscribeTheme = subscribeUiTheme(updateVoid)
      scene.audioSpeed = useStore.getState().speed
      scene.setGraphicsQuality(useStore.getState().graphicsQuality)
      scene.setUpscalingMode(useStore.getState().upscalingMode)
      scene.setEdgeScrolling(false)
      scene.setHideUI(true)
      scene.setHideGround(true)
      scene.setHideRoof(true)
      scene.setAutoCeiling(true)
      const artwork = scene.prepareStandaloneArtwork(snapshot.data)
      // Supply only owned cells: no infinite street window between separated floors.
      scene.setStation(snapshot.data, undefined, snapshot.data.cells)
      scene.setExplodedRampSections(snapshot.offsets, snapshot.direction)
      const resize = (): void => {
        const rect = canvas.current!.getBoundingClientRect()
        scene.resize(rect.width, rect.height)
      }
      observer = new ResizeObserver(resize)
      observer.observe(canvas.current!)
      resize()
      scene.frameStandalonePresentation()
      scene.enableExplodedLayout(snapshot.levels,snapshot.source,snapshot.offsets,snapshot.direction,snapshot.frontWalls)
      scene.setPlaying(useStore.getState().playing)
      scene.onNextFrame = () => {
        setReady(true)
        simulationTimer = window.setTimeout(() => {
          let agentPoses: Float32Array = new Float32Array(0)
          let trainPoses: Float32Array = new Float32Array(0)
          const passengerSupport = explodedPassengerSupport(snapshot.data, snapshot.offsets, snapshot.direction)
          unsubscribe = subscribeFrame((count, agents, _density, trains, lifts, intervalMs, simTime, services, tick) => {
            agentPoses = explodedPoses(agents, 6, snapshot.offsets, snapshot.data.levelBase ?? 0, 0, agentPoses, false, snapshot.direction)
            trainPoses = explodedPoses(trains, 10, snapshot.offsets, snapshot.data.levelBase ?? 0,
              trainOriginForScale(trainScaleForStorey()), trainPoses, true, snapshot.direction)
            scene.setAgents(agentPoses, filterExplodedPassengers(agentPoses, count, passengerSupport), intervalMs, tick)
            scene.setTrains(trainPoses)
            scene.setLifts(explodedLiftPoses(lifts, snapshot.offsets, snapshot.direction))
            scene.setSimClock(simTime, services)
          })
        }, 0)
        const append = (): void => {
          if (cancelled || closing.current) return
          if (scene.appendExplodedEquipment()) setEquipped(true)
          else equipmentTimer = window.setTimeout(append, 16)
        }
        void artwork.then(() => {
          if (!cancelled && !closing.current) equipmentTimer = window.setTimeout(append, 16)
        })
      }
    }, 50)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      cancelled = true
      window.clearTimeout(timer)
      window.clearTimeout(equipmentTimer)
      window.clearTimeout(simulationTimer)
      window.removeEventListener('blur', onBlur)
      unsubscribe?.()
      unsubscribeAudio?.()
      unsubscribeTheme?.()
      gameAudio.stop()
      observer?.disconnect()
      renderer.current?.dispose()
      renderer.current = null
      window.__benchmarkScene = undefined
      modal.close()
      previous?.focus()
    }
  }, [snapshot])

  const rows: ExplodedFloorRow[] = useMemo(
    () =>
      snapshot.levels.map((elevation, index) => ({
        elevation,
        floorVisible: visibility[index]?.floor ?? true,
        wallsVisible: visibility[index]?.walls ?? true,
      })),
    [snapshot.levels, visibility],
  )

  return (
    <ExplodedViewShell
      dialogRef={dialog}
      floorPanelRef={floorPanel}
      ready={ready}
      equipped={equipped}
      rows={rows}
      selectedIndex={selectedFloor}
      onClose={close}
      onReset={() => {
        renderer.current?.resetExplodedLayout()
        setSelectedFloor(null)
      }}
      onSelectIndex={selectFloor}
      onToggleFloor={index => toggleVisibility(index, 'floor')}
      onToggleWalls={index => toggleVisibility(index, 'walls')}
      isCanvasTarget={target => target === canvas.current}
    >
      <canvas
        ref={canvas}
        aria-label={t('exploded_view')}
        onContextMenu={e => e.preventDefault()}
        className={selectedFloor !== null ? 'explodedArrangeCanvas' : undefined}
        onPointerDownCapture={event => {
          if (!ready || event.button !== 0 || !snapshot.levels.length) return
          const floor = renderer.current?.pickExplodedFloor(event.clientX, event.clientY) ?? null
          renderer.current?.selectExplodedFloor(floor)
          setSelectedFloor(floor)
          if (floor === null) return
          renderer.current?.settleExplodedCamera()
          event.stopPropagation()
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, floor }
        }}
        onPointerMoveCapture={event => {
          const previous = drag.current
          if (!previous || previous.id !== event.pointerId) return
          event.stopPropagation()
          renderer.current?.moveExplodedFloor(previous.floor, event.clientX - previous.x, event.clientY - previous.y)
          drag.current = { ...previous, x: event.clientX, y: event.clientY }
        }}
        onPointerUpCapture={event => {
          if (drag.current?.id !== event.pointerId) return
          event.stopPropagation()
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onLostPointerCapture={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
      />
    </ExplodedViewShell>
  )
}
