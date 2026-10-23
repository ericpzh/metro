import { useEffect, useRef, useState } from 'react'
import { toData } from '../../build/model.ts'
import { explodedView, explodedPoses, explodedLiftPoses } from '../../render/explodedView.ts'
import { explodedPassengerSupport, filterExplodedPassengers } from '../../render/explodedPassengers.ts'
import { trainOriginForScale, trainScaleForStorey } from '../../sim/stock.ts'
import { SceneRenderer } from '../../render/scene.ts'
import { t } from '../../sim/i18n.ts'
import { useLanguage } from '../i18n.ts'
import { useStore } from '../store.ts'
import { subscribeFrame } from '../store/slices/SimSlice.ts'
import { SimulationControls } from './topbar/SimulationControls.tsx'
import { SettingsMenu } from './topbar/SettingsMenu.tsx'
import { IoArrowBackOutline } from 'react-icons/io5'

export function ExplodedView(): React.ReactElement | null {
  const open = useStore(s => s.explodedView)
  return open ? <Viewer /> : null
}

function Viewer(): React.ReactElement {
  useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<SceneRenderer | null>(null)
  const [ready, setReady] = useState(false)
  const playing = useStore(s => s.playing)
  const edgeScrolling = useStore(s => s.edgeScrolling)
  useEffect(() => { renderer.current?.setPlaying(playing) }, [playing])
  useEffect(() => { renderer.current?.setEdgeScrolling(edgeScrolling) }, [edgeScrolling])
  // Capture once on opening: simulation ticks and UI state cannot remesh it.
  const [snapshot] = useState(() => explodedView(toData(useStore.getState().station)))
  const close = (): void => useStore.getState().setExplodedView(false)
  useEffect(() => {
    const modal = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    modal.showModal()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        useStore.getState().setExplodedView(false)
      }
      const key = event.key.toLowerCase()
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
    const onBlur = (): void => { renderer.current?.keys.clear() }
    window.addEventListener('blur', onBlur)
    // Let the modal and loading state paint before preparing a large station.
    const timer = window.setTimeout(() => {
      if (snapshot.levels.length === 0) { setReady(true); return }
      const scene = new SceneRenderer(canvas.current!)
      renderer.current = scene
      scene.setStandalonePresentation()
      scene.setGraphicsQuality(useStore.getState().graphicsQuality)
      scene.setEdgeScrolling(useStore.getState().edgeScrolling)
      scene.setHideUI(true)
      scene.setHideGround(true)
      scene.setHideRoof(true)
      scene.setAutoCeiling(true)
      // Supply only owned cells: no infinite street window between separated floors.
      scene.setStation(snapshot.data, undefined, snapshot.data.cells)
      const resize = (): void => {
        const rect = canvas.current!.getBoundingClientRect()
        scene.resize(rect.width, rect.height)
      }
      observer = new ResizeObserver(resize)
      observer.observe(canvas.current!)
      resize()
      scene.frameStandalonePresentation()
      scene.setPlaying(useStore.getState().playing)
      let agentPoses: Float32Array = new Float32Array(0), trainPoses: Float32Array = new Float32Array(0)
      const passengerSupport=explodedPassengerSupport(snapshot.data,snapshot.offsets,snapshot.direction)
      unsubscribe = subscribeFrame((count, agents, _density, trains, lifts, intervalMs, simTime, services) => {
        agentPoses = explodedPoses(agents, 6, snapshot.offsets, snapshot.data.levelBase ?? 0, 0, agentPoses, false, snapshot.direction)
        trainPoses = explodedPoses(trains, 10, snapshot.offsets, snapshot.data.levelBase ?? 0,
          trainOriginForScale(trainScaleForStorey()), trainPoses, true, snapshot.direction)
        scene.setAgents(agentPoses, filterExplodedPassengers(agentPoses,count,passengerSupport), intervalMs)
        scene.setTrains(trainPoses)
        scene.setLifts(explodedLiftPoses(lifts, snapshot.offsets, snapshot.direction))
        scene.setSimClock(simTime, services)
      })
      setReady(true)
    }, 50)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.clearTimeout(timer)
      window.removeEventListener('blur', onBlur)
      unsubscribe?.()
      observer?.disconnect()
      renderer.current?.dispose()
      renderer.current = null
      modal.close()
      previous?.focus()
    }
  }, [snapshot])
  return <dialog ref={dialog} className="explodedViewer" data-ready={ready} aria-label={t('exploded_view')} onCancel={close}>
    <header className="explodedToolbar">
      <strong>{t('exploded_view')}</strong>
      <div className="explodedToolbarControls">
        <button className="explodedBack" autoFocus onClick={close} aria-label={t('back_to_game')}><IoArrowBackOutline /></button>
        <SimulationControls />
        <SettingsMenu />
      </div>
    </header>
    <canvas ref={canvas} aria-label={t('exploded_view')} onContextMenu={e => e.preventDefault()} />
    {(!ready || snapshot.levels.length === 0) && <p className="explodedEmpty" role="status">{t(!ready ? 'exploded_loading' : 'exploded_empty')}</p>}
    <footer className="explodedLevels">{snapshot.levels.map(z => <span key={z}>{z > 0 ? '+' : ''}{z} m</span>)}</footer>
  </dialog>
}
