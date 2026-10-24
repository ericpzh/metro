import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { App } from '../App.tsx'
import { useStore } from '../store.ts'
import { useLanguage } from '../i18n.ts'
import type { ExampleStationId } from '../../data/reference-station.ts'
import { summarizeFrameIntervals } from './benchmarkStats.ts'
import { benchmarkCopy } from './benchmarkCopy.ts'
import './benchmark.css'

type Quality = 'low' | 'high'
type View = 'regular' | 'explode'
type Phase = 'setup' | 'preparing' | 'running' | 'result' | 'error'
interface FrameSample { at: number; interval: number; tick: number }
interface ArrivalSample { at: number; tick: number }
interface Result {
  station: string
  stationId: ExampleStationId
  activeLevel: number
  quality: Quality
  view: View
  frames: FrameSample[]
  arrivals: ArrivalSample[]
  stats: NonNullable<ReturnType<typeof summarizeFrameIntervals>>
  browser: string
  gpu: string
  cpuCores: number | null
  memoryGb: number | null
  viewport: string
  pixelRatio: number
  cells: number
  modules: number
}

const DURATION_MS = 30_000
const SPEED = 16
const LOCKED_GAME_EVENTS = [
  'click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove',
  'pointercancel', 'mousedown', 'mouseup', 'mousemove', 'wheel', 'touchstart', 'touchmove',
  'touchend', 'keydown', 'keyup',
] as const

function stationLabel(id: ExampleStationId, language: string): string {
  if (language === 'en') return id === 'tanwei' ? 'Tanwei' : 'Zoo'
  return id === 'tanwei' ? '坦尾站' : '动物园站'
}
function browserLabel(userAgent: string): string {
  if (/Edg\/(\d+)/.test(userAgent)) return `Edge ${userAgent.match(/Edg\/(\d+)/)?.[1]}`
  if (/Chrome\/(\d+)/.test(userAgent)) return `Chrome ${userAgent.match(/Chrome\/(\d+)/)?.[1]}`
  if (/Firefox\/(\d+)/.test(userAgent)) return `Firefox ${userAgent.match(/Firefox\/(\d+)/)?.[1]}`
  if (/Version\/(\d+).*Safari/.test(userAgent)) return `Safari ${userAgent.match(/Version\/(\d+)/)?.[1]}`
  return 'Browser'
}

function sceneFor(view: View): { framesRendered: number; zoomBy: (factor: number) => void; setViewDirection: (direction: THREE.Vector3, useOrtho: boolean) => void; renderer: { domElement: HTMLCanvasElement; getContext: () => WebGLRenderingContext | WebGL2RenderingContext } } | null {
  const host = window as typeof window & { __benchmarkScene?: typeof window.__scene }
  return (view === 'explode' ? host.__benchmarkScene : window.__scene) ?? null
}

function waitUntil(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const poll = (): void => {
      if (predicate()) { resolve(); return }
      if (performance.now() - started > timeoutMs) { reject(new Error(message)); return }
      window.setTimeout(poll, 100)
    }
    poll()
  })
}

function graphPath(frames: FrameSample[], width: number, height: number): string {
  if (!frames.length) return ''
  const maxFps = 60
  return frames.map((frame, index) => {
    const x = Math.min(width, Math.max(0, frame.at / DURATION_MS * width))
    const fps = Math.min(maxFps, 1000 / frame.interval)
    const y = height - fps / maxFps * height
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function BenchmarkChart({ result, copy }: { result: Result; copy: ReturnType<typeof benchmarkCopy> }): React.ReactElement {
  const width = 1000, height = 280, viewHeight = 360
  const path = graphPath(result.frames, width, height)
  return <div className="benchmarkChartWrap">
    <svg className="benchmarkChart" viewBox={`0 0 ${width} ${viewHeight}`} role="img" aria-label={copy.fpsChart}>
      {[0, 15, 30, 45, 60].map((fps) => {
        const y = height - fps / 60 * height
        return <g key={fps}><line x1="0" x2={width} y1={y} y2={y} className="benchmarkGrid"/><text x="-12" y={y + 4} className="benchmarkAxis" textAnchor="end">{fps}</text></g>
      })}
      {[0, 5, 10, 15, 20, 25, 30].map((seconds) => <text key={seconds} x={seconds / 30 * width} y={height + 25} className="benchmarkAxis" textAnchor={seconds === 0 ? 'start' : seconds === 30 ? 'end' : 'middle'}>{seconds}{copy.secShort}</text>)}
      {path && <path d={path} className="benchmarkLine"><title>{copy.capped}</title></path>}
      {result.arrivals.map(({ at, tick }, index) => {
        const x = at / DURATION_MS * width
        return <g key={`${tick}-${index}`}><line x1={x} x2={x} y1="0" y2={height} className="benchmarkArrival"/><text x={Math.min(width - 42, x + 4)} y={14 + (index % 2) * 14} className="benchmarkArrivalLabel">{copy.tick} {tick}</text></g>
      })}
      <text x="0" y="-12" className="benchmarkAxisTitle">FPS</text>
      <text x={width / 2} y={height + 65} className="benchmarkAxisTitle" textAnchor="middle">{copy.secondsWall}</text>
    </svg>
    <div className="benchmarkChartNote">{copy.chartNote}</div>
  </div>
}

export function BenchmarkRoute(): React.ReactElement {
  const language = useLanguage()
  const copy = benchmarkCopy(language)
  const [stationId, setStationId] = useState<ExampleStationId>('tanwei')
  const [quality, setQuality] = useState<Quality>('low')
  const [view, setView] = useState<View>('regular')
  const [phase, setPhase] = useState<Phase>('setup')
  const [remaining, setRemaining] = useState(30)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingStep, setLoadingStep] = useState('')
  const [appMounted, setAppMounted] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const controlsLocked = phase === 'preparing' || phase === 'running'

  useEffect(() => {
    if (!controlsLocked) {
      delete document.body.dataset.metroBenchmarkLocked
      return
    }
    document.body.dataset.metroBenchmarkLocked = 'true'
    const block = (event: Event): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    for (const type of LOCKED_GAME_EVENTS) window.addEventListener(type, block, { capture: true, passive: false })
    return () => {
      delete document.body.dataset.metroBenchmarkLocked
      for (const type of LOCKED_GAME_EVENTS) window.removeEventListener(type, block, true)
    }
  }, [controlsLocked])

  const begin = async (): Promise<void> => {
    setError('')
    setResult(null)
    setRemaining(30)
    setPhase('preparing')
    setAppMounted(false)
    setLoadingProgress(4)
    setLoadingStep(copy.booting)
    document.body.dataset.metroBenchmarkLocked = 'true'
    window.__scene?.keys.clear()
    window.__benchmarkScene?.keys.clear()
    // Paint the loading screen before mounting the game. Mounting its renderer
    // and replacing the station can block the main thread for several seconds.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    setAppMounted(true)
    setLoadingProgress(16)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const store = useStore.getState()
    store.setPlaying(false)
    store.setSpeed(SPEED)
    store.setGraphicsQuality(quality)
    store.setExplodedView(view === 'explode')
    store.setHideUI(view === 'regular' && stationId === 'tanwei')
    store.setHideGround(view === 'regular' && stationId === 'zoo')
    store.setGhostOther(true)
    setLoadingStep(copy.loadingStation)
    setLoadingProgress(28)
    store.loadReference(stationId)
    if (view === 'regular' && stationId === 'zoo') useStore.getState().setActiveZ(-15)
    // loadReference selects the demo's opening/default level, including its
    // lowest authored storey. Preserve it for normal-view measurements; ground
    // level would change the visible workload.
    try {
      await waitUntil(() => !!window.__metro?.getState().metrics, 30_000, copy.setupError)
      setLoadingStep(copy.preparingScene)
      setLoadingProgress(48)
      if (view === 'explode') {
        await waitUntil(() => document.querySelector('.explodedViewer')?.getAttribute('data-ready') === 'true' && !!sceneFor(view), 30_000, copy.explodedError)
      } else {
        await waitUntil(() => {
          const scene = sceneFor(view) as unknown as { framesRendered: number; ctx?: { stationData?: { cells?: unknown[] } } } | null
          const station = window.__metro?.getState().station
          return !!scene && scene.framesRendered > 1 && !!station && scene.ctx?.stationData?.cells?.length === station.cells.length
        }, 60_000, copy.stationError)
      }
      setLoadingProgress(78)
      setLoadingStep(copy.settling)
      // Let the opening scene and asset uploads settle before measuring playback.
      await new Promise((resolve) => window.setTimeout(resolve, 900))
      const scene = sceneFor(view)
      if (!scene) throw new Error(copy.rendererError)
      if (view === 'regular') {
        // Camera zoom factors scale distance/frustum. 2/3 distance gives the
        // requested 50% closer preset without changing the game's camera state.
        if (stationId === 'zoo') scene.setViewDirection(new THREE.Vector3(-1, 1, 1), false)
        scene.zoomBy(2 / 3)
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      }
      setLoadingProgress(100)
      setPhase('running')
      const frames: FrameSample[] = []
      const arrivals: ArrivalSample[] = []
      let lastSubmitted = performance.now()
      let submittedCount = scene.framesRendered
      let lastArrivals = window.__metro!.getState().metrics?.trainArrivals ?? 0
      let displayedSecond = 30
      const started = performance.now()
      const storeApi = window.__metro!
      storeApi.getState().setPlaying(true)
      await new Promise<void>((resolve) => {
        const sample = (): void => {
          const now = performance.now()
          const metrics = storeApi.getState().metrics
          if (scene.framesRendered !== submittedCount) {
            frames.push({ at: now - started, interval: now - lastSubmitted, tick: metrics?.tick ?? 0 })
            lastSubmitted = now
            submittedCount = scene.framesRendered
          }
          const count = metrics?.trainArrivals ?? lastArrivals
          if (count > lastArrivals) arrivals.push({ at: now - started, tick: metrics?.tick ?? 0 })
          lastArrivals = count
          const elapsed = now - started
          const nextSecond = Math.max(0, Math.ceil((DURATION_MS - elapsed) / 1000))
          if (nextSecond !== displayedSecond) {
            displayedSecond = nextSecond
            setRemaining(nextSecond)
          }
          if (elapsed >= DURATION_MS) resolve()
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      storeApi.getState().setPlaying(false)
      const intervals = frames.slice(1).map((frame) => frame.interval)
      const stats = summarizeFrameIntervals(intervals)
      if (!stats) throw new Error(copy.noFramesError)
      const gl = scene.renderer.getContext()
      const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null
      const gpu = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
      const canvas = scene.renderer.domElement
      const current = storeApi.getState()
      setResult({ station: current.station.name, stationId, activeLevel: current.activeZ, quality, view, frames, arrivals, stats,
        browser: navigator.userAgent, gpu, cpuCores: navigator.hardwareConcurrency || null,
        memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        viewport: `${canvas.clientWidth} × ${canvas.clientHeight}`, pixelRatio: window.devicePixelRatio,
        cells: current.station.cells.length, modules: current.station.modules.length })
      setPhase('result')
    } catch (cause) {
      useStore.getState().setPlaying(false)
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    }
  }

  const retry = (): void => {
    useStore.getState().setPlaying(false)
    useStore.getState().setExplodedView(false)
    setResult(null)
    setPhase('setup')
  }

  const cleanPath = location.pathname.replace(/\/+$/, '')
  const basePath = cleanPath.endsWith('/en') ? cleanPath.slice(0, -3) : cleanPath
  const languagePath = language === 'en' ? basePath : `${basePath}/en`

  return <>
    {appMounted && (phase === 'preparing' || phase === 'running') && <App />}
    {phase !== 'preparing' && phase !== 'running' && <nav className="benchmarkLocale"><a href={languagePath}>{copy.language}</a></nav>}
    {phase === 'setup' && <main className="benchmarkPage"><section className="benchmarkSetup">
      <div className="benchmarkEyebrow">{copy.eyebrow}</div>
      <h1>{copy.title}</h1>
      <p>{copy.intro}</p>
      <label>{copy.station}<select value={stationId} onChange={(event) => setStationId(event.target.value as ExampleStationId)}><option value="zoo">{copy.zoo}</option><option value="tanwei">{copy.tanwei}</option></select></label>
      <fieldset><legend>{copy.graphics}</legend><div className="benchmarkChoices">
        <button type="button" aria-pressed={quality === 'low'} onClick={() => setQuality('low')}>{copy.low}</button>
        <button type="button" aria-pressed={quality === 'high'} onClick={() => setQuality('high')}>{copy.high}</button>
      </div></fieldset>
      <fieldset><legend>{copy.view}</legend><div className="benchmarkChoices">
        <button type="button" aria-pressed={view === 'regular'} onClick={() => setView('regular')}>{copy.normal}</button>
        <button type="button" aria-pressed={view === 'explode'} onClick={() => setView('explode')}>{copy.explode}</button>
      </div></fieldset>
      <button className="benchmarkStart" type="button" onClick={() => void begin()}>{copy.start}</button>
      <small>{copy.keepVisible}</small>
    </section></main>}
    {phase === 'preparing' && <section className="benchmarkLoadingScreen" role="status" aria-live="polite">
      <div className="benchmarkLoadingCard">
        <div className="benchmarkEyebrow">{copy.preparing}</div>
        <h1>{stationId === 'zoo' ? copy.zoo : copy.tanwei}</h1>
        <p>{loadingStep || copy.loading}</p>
        <div className="benchmarkProgressTrack" role="progressbar" aria-label={copy.preparing} aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingProgress}>
          <span style={{ width: `${loadingProgress}%` }}/>
        </div>
        <div className="benchmarkLoadingMeta"><span>{loadingProgress}%</span><span>{copy.controlsLocked}</span></div>
      </div>
    </section>}
    {phase === 'running' && <aside className="benchmarkHud"><div><b>{copy.running}</b><span>{`${remaining}${copy.seconds} · ${stationId === 'zoo' ? copy.zoo : copy.tanwei} · ${quality === 'low' ? copy.low : copy.high} · ${view === 'explode' ? copy.explode : copy.normal} · ${copy.controlsLocked}`}</span></div></aside>}
    {(phase === 'error' || phase === 'result') && <main className="benchmarkPage benchmarkResultsPage">
      {phase === 'error' ? <section className="benchmarkSetup"><h1>{copy.couldNotFinish}</h1><p role="alert">{error}</p><button type="button" className="benchmarkStart" onClick={retry}>{copy.back}</button></section> : result && <article className="benchmarkResult">
        <header className="benchmarkResultHeader"><div><div className="benchmarkEyebrow">{copy.first30}</div><h1>{stationLabel(result.stationId, language)}</h1><p>{result.quality === 'low' ? copy.low : copy.high} · 16× · {browserLabel(result.browser)} / {result.gpu}</p></div><button type="button" onClick={retry}>{copy.again}</button></header>
        <div className="benchmarkMetricRow"><div><span>{copy.average}</span><strong>{result.stats.averageFps.toFixed(2)}</strong></div><div><span>{copy.low1}</span><strong>{result.stats.onePercentLowFps.toFixed(2)}</strong></div><div><span>{copy.worst}</span><strong>{result.stats.worstFrameMs.toFixed(0)} <small>ms</small></strong></div><div><span>{copy.view}</span><strong>{result.view === 'explode' ? copy.explode : copy.normal}</strong></div></div>
        <BenchmarkChart result={result} copy={copy}/>
        <section className="benchmarkHardware"><h2>{copy.hardware}</h2><dl>
          <div><dt>{copy.browser}</dt><dd>{result.browser}</dd></div><div><dt>{copy.gpu}</dt><dd>{result.gpu}</dd></div>
          <div><dt>{copy.cores}</dt><dd>{result.cpuCores ?? copy.unavailable}</dd></div><div><dt>{copy.memory}</dt><dd>{result.memoryGb ? `${result.memoryGb} GB` : copy.unavailable}</dd></div>
          <div><dt>{copy.viewport}</dt><dd>{result.viewport} {copy.dpr} {result.pixelRatio.toFixed(2)}</dd></div><div><dt>{copy.geometry}</dt><dd>{result.cells.toLocaleString()} {copy.cells} · {result.modules.toLocaleString()} {copy.modules}</dd></div>
          <div><dt>{copy.run}</dt><dd>{stationLabel(result.stationId, language)} · {result.quality === 'low' ? copy.low : copy.high} · {result.view === 'explode' ? copy.explode : copy.normal} · {copy.level} {result.activeLevel} m · {result.view === 'regular' ? `${copy.zoom} · ` : ''}16× · 30{copy.secShort}</dd></div>
          <div><dt>{copy.samples}</dt><dd>{Math.max(0, result.frames.length - 1).toLocaleString()} {copy.intervals} · {result.arrivals.length} {copy.arrivals}</dd></div>
        </dl><p>{copy.intervalInfo}</p></section>
      </article>}
    </main>}
  </>
}
