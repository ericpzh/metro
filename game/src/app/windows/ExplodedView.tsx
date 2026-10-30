import {gameAudio} from '../gameAudio.ts'
import {getAudioVolumes,subscribeAudioVolumes} from '../audioSettings.ts'
import { getUiTheme, subscribeUiTheme, themeVoidColor } from '../uiTheme.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { IoEyeOutline, IoEyeOffOutline } from 'react-icons/io5'
import { TbWall, TbWallOff } from 'react-icons/tb'
import { RiResetLeftFill } from 'react-icons/ri'

export function ExplodedView(): React.ReactElement | null {
  const open = useStore(s => s.explodedView)
  return open ? <Viewer /> : null
}

function Viewer(): React.ReactElement {
  useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<SceneRenderer | null>(null)
  const floorPanel=useRef<HTMLElement>(null)
  const [ready, setReady] = useState(false)
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; floor: number } | null>(null)
  const playing = useStore(s => s.playing)
  const speed = useStore(s => s.speed)
  const upscalingMode = useStore(s => s.upscalingMode)
  useEffect(() => { renderer.current?.setPlaying(playing) }, [playing])
  useEffect(() => { if(renderer.current)renderer.current.audioSpeed=speed }, [speed])
  useEffect(() => { renderer.current?.setUpscalingMode(upscalingMode) }, [upscalingMode])
  // Capture once on opening: simulation ticks and UI state cannot remesh it.
  const [snapshot] = useState(() => {
    const source=toData(useStore.getState().station)
    return {...explodedView(source),source}
  })
  const visibilityRef=useRef(snapshot.levels.map(()=>({floor:true,walls:true})))
  const [visibility,setVisibility]=useState(visibilityRef.current)
  const selectFloor=(index:number|null):void=>{renderer.current?.selectExplodedFloor(index);setSelectedFloor(index)}
  const toggleVisibility=(index:number,part:'floor'|'walls'):void=>{
    const next=visibilityRef.current.map((value,i)=>i===index?{...value,[part]:!value[part]}:value)
    visibilityRef.current=next
    setVisibility(next)
    renderer.current?.setExplodedFloorVisibility(index,next[index].floor,next[index].walls)
  }
  useLayoutEffect(()=>{
    const scene=renderer.current
    if(!scene||selectedFloor===null)return
    scene.onExplodedFloorAnchor=point=>{
      const panel=floorPanel.current,view=canvas.current
      if(!panel||!view)return
      const width=view.clientWidth,height=view.clientHeight
      panel.style.left=`${Math.max(8,Math.min(width-panel.offsetWidth-8,point[0]+12))}px`
      panel.style.top=`${view.offsetTop+Math.max(8,Math.min(height-panel.offsetHeight-8,point[1]-panel.offsetHeight/2))}px`
    }
    const point=scene.getExplodedFloorAnchor()
    if(point)scene.onExplodedFloorAnchor(point)
    scene.requestRender()
    return()=>{scene.onExplodedFloorAnchor=null}
  },[selectedFloor])
  const close = (): void => useStore.getState().setExplodedView(false)
  useEffect(() => {
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
        useStore.getState().setExplodedView(false)
      }
      const key = event.key.toLowerCase()
      if((event.target as Element)?.closest?.('.explodedFloorPanel, .explodedLevels button') && [' ','Enter'].includes(event.key))return
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
    const timer = window.setTimeout(() => {
      if (snapshot.levels.length === 0) { setReady(true); return }
      const scene = new SceneRenderer(canvas.current!)
      renderer.current = scene
      window.__benchmarkScene = scene
      const updateAudio=():void=>{const volumes=getAudioVolumes();scene.onAudioFrame=volumes.master>0&&volumes.ambient>0?frame=>gameAudio.updateScene({...frame,speed:useStore.getState().speed}):null}
      updateAudio()
      unsubscribeAudio=subscribeAudioVolumes(updateAudio)
      scene.setStandalonePresentation()
      const updateVoid = (): void => {
        const theme = getUiTheme()
        scene.setVoidColor(themeVoidColor(theme), theme === 'studio' ? themeVoidColor(theme) : 0x192532)
      }
      updateVoid()
      unsubscribeTheme = subscribeUiTheme(updateVoid)
      scene.audioSpeed=useStore.getState().speed
      scene.setGraphicsQuality(useStore.getState().graphicsQuality)
      scene.setUpscalingMode(useStore.getState().upscalingMode)
      scene.setEdgeScrolling(false)
      scene.setHideUI(true)
      scene.setHideGround(true)
      scene.setHideRoof(true)
      scene.setAutoCeiling(true)
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
      scene.enableExplodedLayout(snapshot.levels,snapshot.source,snapshot.offsets,snapshot.direction)
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
  return <dialog ref={dialog} className="explodedViewer" data-ready={ready} aria-label={t('exploded_view')} onCancel={close}
    onPointerDownCapture={event => {
      if(event.target !== canvas.current && !(event.target as Element).closest('.explodedFloorPanel'))selectFloor(null)
    }}>
    <header className="explodedToolbar">
      <strong>{t('exploded_view')}</strong>
      <button className="explodedReset" disabled={!ready} aria-label={t('exploded_reset')} title={t('exploded_reset')}
        onClick={() => { renderer.current?.resetExplodedLayout(); setSelectedFloor(null) }}><RiResetLeftFill /></button>
      <div className="explodedToolbarControls">
        <button className="explodedBack" autoFocus onClick={close} aria-label={t('back_to_game')}><IoArrowBackOutline /></button>
        <SimulationControls />
        <SettingsMenu />
      </div>
    </header>
    <canvas ref={canvas} aria-label={t('exploded_view')} onContextMenu={e => e.preventDefault()}
      className={selectedFloor !== null ? 'explodedArrangeCanvas' : undefined}
      onPointerDownCapture={event => {
        if (!ready || event.button !== 0 || !snapshot.levels.length) return
        const floor = renderer.current?.pickExplodedFloor(event.clientX,event.clientY) ?? null
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
      onPointerCancel={() => { drag.current = null }} />
    {(!ready || snapshot.levels.length === 0) && <p className="explodedEmpty" role="status">{t(!ready ? 'exploded_loading' : 'exploded_empty')}</p>}
    {selectedFloor!==null && <aside ref={floorPanel} className="explodedFloorPanel" aria-label={t('exploded_layers')} onKeyDown={event=>event.stopPropagation()}>
      <strong>{t('exploded_layers')} · {snapshot.levels[selectedFloor]} m</strong>
      <div className="selected">
        <span>{snapshot.levels[selectedFloor]>0?'+':''}{snapshot.levels[selectedFloor]} m</span>
        <button type="button" aria-pressed={visibility[selectedFloor].floor} aria-label={t('exploded_control_label',t(visibility[selectedFloor].floor?'exploded_hide_floor':'exploded_show_floor'),snapshot.levels[selectedFloor])}
          title={t(visibility[selectedFloor].floor?'exploded_hide_floor':'exploded_show_floor')} onClick={()=>toggleVisibility(selectedFloor,'floor')}>
          {visibility[selectedFloor].floor?<IoEyeOutline/>:<IoEyeOffOutline/>}
        </button>
        <button type="button" aria-pressed={visibility[selectedFloor].walls} aria-label={t('exploded_control_label',t(visibility[selectedFloor].walls?'hide_walls':'exploded_show_walls'),snapshot.levels[selectedFloor])}
          title={t(visibility[selectedFloor].walls?'hide_walls':'exploded_show_walls')} onClick={()=>toggleVisibility(selectedFloor,'walls')}>
          {visibility[selectedFloor].walls?<TbWall/>:<TbWallOff/>}
        </button>
      </div>
    </aside>}
    <footer className="explodedLevels">
      <span>{t('exploded_arrange_hint')}</span>
      {snapshot.levels.map((z,index) => <button type="button" key={z} disabled={!ready} aria-pressed={selectedFloor===index}
        className={`${selectedFloor===index?'explodedSelectedLevel ':''}${visibility[index].floor?'':'explodedHiddenLevel'}`}
        onKeyDown={event=>event.stopPropagation()} onClick={()=>selectFloor(index)}>{z > 0 ? '+' : ''}{z} m</button>)}
    </footer>
  </dialog>
}
