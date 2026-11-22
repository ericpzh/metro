import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import type { ExampleStationId } from '../data/reference-station.ts'
import type { UpscalingMode } from '../render/upscaling.ts'
import type { Language } from '../sim/i18n.ts'
import type { ModelDetailProfile } from '../app/windows/StationHost.tsx'
import { useStore } from '../app/store.ts'
import { setLanguage, useLanguage } from '../app/i18n.ts'
import { benchmarkHrefFor, benchmarkLanguagePath, isBenchmarkPath } from '../app/languageRoute.ts'
import { summarizeFrameIntervals } from '../app/benchmark/benchmarkStats.ts'
import { BENCHMARK_COPY, benchmarkCopy } from '../app/benchmark/benchmarkCopy.ts'
import { parseExplodedHostState } from './explodedInput.ts'
import { stationBridge } from './stationBridge.ts'
import '../app/benchmark/benchmark.css'

type View = 'regular' | 'explode'
type Phase = 'setup' | 'preparing' | 'running' | 'result' | 'error'
interface FrameSample { at: number; interval: number; tick: number }
interface ArrivalSample { at: number; tick: number }
interface ResourceSample { at: number; cpu: number | null; gpu: number | null; ram: number | null }
interface NativeBenchmarkHardware {
  gpu?: string
  gpuApi?: string
  vramMb?: number | null
  cpu?: string
  cpuCores?: number | null
  memoryGb?: number | null
  screenWidth?: number
  screenHeight?: number
  engine?: string
  platform?: string
  isDesktop?: boolean
}
interface NativeBenchmarkStop {
  recording?: boolean
  frames?: unknown[]
  resources?: ResourceSample[]
  hardware?: NativeBenchmarkHardware
}
interface Result {
  station: string
  stationId: ExampleStationId
  modelDetail: ModelDetailProfile
  upscalingMode: UpscalingMode
  upscalingBackend: string
  isDesktop: boolean
  nativeMemory: boolean
  ticks: number
  activeLevel: number
  view: View
  frames: FrameSample[]
  arrivals: ArrivalSample[]
  resources: ResourceSample[]
  stats: NonNullable<ReturnType<typeof summarizeFrameIntervals>>
  browser: string
  runtimeLabel: string
  gpu: string
  cpuCores: number | null
  memoryGb: number | null
  viewport: string
  pixelRatio: number
  cells: number
  modules: number
}

const UNITY_STATIONS: readonly ExampleStationId[] = ['zoo', 'tanwei', 'tianhe']
const MODEL_DETAIL_PROFILES: readonly ModelDetailProfile[] = ['low', 'balanced', 'high']
const FSR_MODES: readonly UpscalingMode[] = ['ultra', 'quality', 'balanced', 'performance', 'native']
const DURATION_MS = 30_000
const SPEED = 16
const isModelDetailProfile = (value: unknown): value is ModelDetailProfile =>
  value === 'low' || value === 'balanced' || value === 'high'
const isUpscalingMode = (value: unknown): value is UpscalingMode =>
  value === 'native' || value === 'ultra' || value === 'quality' || value === 'balanced' || value === 'performance'
const LOCKED_GAME_EVENTS = [
  'click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove',
  'pointercancel', 'mousedown', 'mouseup', 'mousemove', 'wheel', 'touchstart', 'touchmove',
  'touchend', 'keydown', 'keyup',
] as const

interface UnityLoaderWindow extends Window {
  metroUnityInstance?: unknown
  __metroUnityDownloadProgress?: number
  __metroUnityLoadError?: string
}

function stationLabel(id: ExampleStationId, language: string): string {
  const copy = BENCHMARK_COPY[language === 'en' ? 'en' : 'zh']
  return copy[id]
}

function browserLabel(userAgent: string): string {
  if (/Edg\/(\d+)/.test(userAgent)) return `Edge ${userAgent.match(/Edg\/(\d+)/)?.[1]}`
  if (/Chrome\/(\d+)/.test(userAgent)) return `Chrome ${userAgent.match(/Chrome\/(\d+)/)?.[1]}`
  if (/Firefox\/(\d+)/.test(userAgent)) return `Firefox ${userAgent.match(/Firefox\/(\d+)/)?.[1]}`
  if (/Version\/(\d+).*Safari/.test(userAgent)) return `Safari ${userAgent.match(/Version\/(\d+)/)?.[1]}`
  return 'Browser'
}

function readGpuRenderer(canvas: HTMLCanvasElement, fallback: string): string {
  try {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null
    if (!gl) return fallback
    const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null
    return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
  } catch {
    return fallback
  }
}

function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
  onPoll?: () => string | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const poll = (): void => {
      const failReason = onPoll?.()
      if (failReason) { reject(new Error(failReason)); return }
      if (predicate()) { resolve(); return }
      if (performance.now() - started > timeoutMs) { reject(new Error(message)); return }
      window.setTimeout(poll, 100)
    }
    poll()
  })
}

function parseNativeFrames(raw: unknown): FrameSample[] {
  if (!Array.isArray(raw)) return []
  const parsed: FrameSample[] = []
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 3) {
      const at = Number(item[0])
      const interval = Number(item[1])
      const tick = Number(item[2])
      if (Number.isFinite(at) && Number.isFinite(interval) && interval > 0 && Number.isFinite(tick)) {
        parsed.push({ at, interval, tick })
      }
    }
  }
  return parsed
}

function fpsCeilingFor(frames: FrameSample[]): number {
  let peak = 60
  for (let i = 1; i < frames.length; i++) {
    const interval = frames[i]!.interval
    if (interval > 0) peak = Math.max(peak, 1000 / interval)
  }
  if (peak <= 62) return 60
  for (const step of [120, 180, 240, 360, 480]) {
    if (peak <= step) return step
  }
  return Math.ceil(peak / 60) * 60
}

function graphPath(frames: FrameSample[], width: number, height: number, maxFps: number): string {
  if (!frames.length) return ''
  return frames.map((frame, index) => {
    const x = Math.min(width, Math.max(0, frame.at / DURATION_MS * width))
    const fps = Math.min(maxFps, 1000 / frame.interval)
    const y = height - fps / maxFps * height
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function resourcePath(samples: ResourceSample[], metric: 'cpu' | 'gpu' | 'ram', width: number, height: number, max: number): string {
  let hasPoint = false
  return samples.flatMap(sample => {
    const value = sample[metric]
    if (value === null) return []
    const x = Math.min(width, Math.max(0, sample.at / DURATION_MS * width))
    const y = height - Math.min(max, Math.max(0, value)) / max * height
    const command = hasPoint ? 'L' : 'M'
    hasPoint = true
    return [`${command}${x.toFixed(1)},${y.toFixed(1)}`]
  }).join(' ')
}

function ResourceChart({ result, copy }: { result: Result; copy: ReturnType<typeof benchmarkCopy> }): ReactElement {
  const width = 1000, height = 240, viewHeight = 320
  const ramValues = result.resources.flatMap(sample => sample.ram === null ? [] : [sample.ram])
  const maxRam = Math.max(256, Math.ceil(Math.max(0, ...ramValues) / 256) * 256)
  const paths = {
    cpu: resourcePath(result.resources, 'cpu', width, height, 100),
    gpu: resourcePath(result.resources, 'gpu', width, height, 100),
    ram: resourcePath(result.resources, 'ram', width, height, maxRam),
  }
  return <div className="benchmarkChartWrap benchmarkResourceChartWrap">
    <svg className="benchmarkChart" viewBox={`0 0 ${width + 75} ${viewHeight}`} role="img" aria-label={copy.resourceChart}>
      {[0, 25, 50, 75, 100].map(value => {
        const y = height - value / 100 * height
        return <g key={value}><line x1="0" x2={width} y1={y} y2={y} className="benchmarkGrid"/><text x="-12" y={y + 4} className="benchmarkAxis" textAnchor="end">{value}%</text><text x={width + 12} y={y + 4} className="benchmarkAxis">{Math.round(maxRam * value / 100)} MB</text></g>
      })}
      {[0, 5, 10, 15, 20, 25, 30].map(seconds => <text key={seconds} x={seconds / 30 * width} y={height + 25} className="benchmarkAxis" textAnchor={seconds === 0 ? 'start' : seconds === 30 ? 'end' : 'middle'}>{seconds}{copy.secShort}</text>)}
      {paths.cpu && <path d={paths.cpu} className="benchmarkResourceLine benchmarkCpuLine"/>}
      {paths.gpu && <path d={paths.gpu} className="benchmarkResourceLine benchmarkGpuLine"/>}
      {paths.ram && <path d={paths.ram} className="benchmarkResourceLine benchmarkRamLine"/>}
      <text x="0" y="-12" className="benchmarkAxisTitle">{copy.resourcePercent}</text>
      <text x={width} y="-12" className="benchmarkAxisTitle" textAnchor="end">{result.nativeMemory ? copy.unityDesktopRamMb : copy.ramMb}</text>
      <text x={width / 2} y={height + 65} className="benchmarkAxisTitle" textAnchor="middle">{copy.secondsWall}</text>
    </svg>
    <div className="benchmarkResourceLegend"><span className="benchmarkCpuKey">{copy.cpuUsage}</span><span className="benchmarkGpuKey">{copy.gpuUsage}</span><span className="benchmarkRamKey">{result.nativeMemory ? copy.unityDesktopRamUsage : copy.ramUsage}</span></div>
    <div className="benchmarkChartNote">{result.nativeMemory ? copy.unityDesktopResourceNote : copy.unityResourceNote}</div>
  </div>
}

function BenchmarkChart({ result, copy }: { result: Result; copy: ReturnType<typeof benchmarkCopy> }): ReactElement {
  const width = 1000, height = 280, viewHeight = 360
  const maxFps = fpsCeilingFor(result.frames)
  const yTicks = [0, Math.round(maxFps * 0.25), Math.round(maxFps * 0.5), Math.round(maxFps * 0.75), maxFps]
  const path = graphPath(result.frames, width, height, maxFps)
  return <div className="benchmarkChartWrap">
    <svg className="benchmarkChart" viewBox={`0 0 ${width} ${viewHeight}`} role="img" aria-label={copy.fpsChart}>
      {yTicks.map(fps => {
        const y = height - fps / maxFps * height
        return <g key={fps}><line x1="0" x2={width} y1={y} y2={y} className="benchmarkGrid"/><text x="-12" y={y + 4} className="benchmarkAxis" textAnchor="end">{fps}</text></g>
      })}
      {[0, 5, 10, 15, 20, 25, 30].map(seconds => <text key={seconds} x={seconds / 30 * width} y={height + 25} className="benchmarkAxis" textAnchor={seconds === 0 ? 'start' : seconds === 30 ? 'end' : 'middle'}>{seconds}{copy.secShort}</text>)}
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

export function UnityBenchmarkRoute({
  canvas,
  app,
  desktop = false,
  onExit,
}: {
  canvas: HTMLCanvasElement
  app: ReactElement
  desktop?: boolean
  onExit?: () => void
}): ReactElement {
  const language = useLanguage()
  const copy = benchmarkCopy(language)
  const [stationId, setStationId] = useState<ExampleStationId>('tianhe')
  const [modelDetail, setModelDetail] = useState<ModelDetailProfile>('low')
  const [upscalingMode, setUpscalingMode] = useState<UpscalingMode>('native')
  const detailLabels: Record<ModelDetailProfile, string> = {
    low: copy.detailLow,
    balanced: copy.detailBalanced,
    high: copy.detailHigh,
  }
  const fsrLabels: Record<UpscalingMode, string> = {
    native: copy.fsrOff,
    ultra: copy.fsrUltra,
    quality: copy.fsrQuality,
    balanced: copy.fsrBalanced,
    performance: copy.fsrPerformance,
  }
  const [view, setView] = useState<View>('regular')
  const [phase, setPhase] = useState<Phase>('setup')
  const [remaining, setRemaining] = useState(30)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingStep, setLoadingStep] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const hudRef = useRef<HTMLElement>(null)
  const controlsLocked = phase === 'preparing' || phase === 'running'

  useLayoutEffect(() => {
    document.body.dataset.metroBenchmarkActive = 'true'
    window.dispatchEvent(new CustomEvent('metro:benchmark-mode', { detail: { active: true } }))
    stationBridge.send('benchmark.mode', { active: true })
    return () => {
      delete document.body.dataset.metroBenchmarkActive
      window.dispatchEvent(new CustomEvent('metro:benchmark-mode', { detail: { active: false } }))
      stationBridge.send('benchmark.mode', { active: false })
    }
  }, [])

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

  // Keep the running HUD visible above <dialog class="explodedViewer"> when exploded mode is active.
  useEffect(() => {
    const hud = hudRef.current as (HTMLElement & { showPopover?: () => void; hidePopover?: () => void }) | null
    if (!hud) return
    if (phase === 'running' && view === 'explode') {
      try { hud.showPopover?.() } catch { /* popover unsupported or already open */ }
    }
    return () => {
      try { hud.hidePopover?.() } catch { /* ignore */ }
    }
  }, [phase, view])

  const begin = async (): Promise<void> => {
    const loaderHost = window as UnityLoaderWindow
    let savedDetail: ModelDetailProfile | null = null
    let savedUpscaling: UpscalingMode | null = null
    setError('')
    setResult(null)
    setRemaining(30)
    setPhase('preparing')
    setLoadingProgress(4)
    setLoadingStep(desktop ? copy.unityDesktopBooting : copy.unityBooting)
    document.body.dataset.metroBenchmarkLocked = 'true'
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    try {
      await waitUntil(
        () => Boolean((desktop || loaderHost.metroUnityInstance) && stationBridge.getSnapshot().ready && stationBridge.getSnapshot().revision >= 0),
        120_000,
        desktop ? copy.unityDesktopError : copy.unityError,
        () => {
          if (loaderHost.__metroUnityLoadError) return loaderHost.__metroUnityLoadError
          const p = loaderHost.__metroUnityDownloadProgress
          if (typeof p === 'number' && Number.isFinite(p)) {
            setLoadingProgress(prev => Math.max(prev, Math.min(36, Math.round(4 + p * 32))))
          }
          return null
        },
      )

      const store = useStore.getState()
      store.setExplodedView(false)
      stationBridge.send('sim.play', { playing: false })
      stationBridge.send('sim.speed', { speed: SPEED })

      // Apply the benchmark's selected LOD and FSR modes before opening the station, and
      // restore the player's saved PlayerPrefs settings when this run finishes.
      const currentGraphics = await stationBridge.request<{ profile?: unknown; upscaling?: unknown }>('graphics.get', {})
      if (isModelDetailProfile(currentGraphics.profile)) savedDetail = currentGraphics.profile
      if (isUpscalingMode(currentGraphics.upscaling)) savedUpscaling = currentGraphics.upscaling
      const appliedGraphics = await stationBridge.request<{ profile?: unknown; upscaling?: unknown; upscalingBackend?: unknown }>('graphics.set', {
        profile: modelDetail,
        upscaling: upscalingMode,
      })
      if (appliedGraphics.profile !== modelDetail || appliedGraphics.upscaling !== upscalingMode) {
        throw new Error(copy.detailError)
      }
      const upscalingBackend = typeof appliedGraphics.upscalingBackend === 'string' ? appliedGraphics.upscalingBackend : 'off'

      const prevRevision = stationBridge.getSnapshot().revision
      const prevRejectCount = stationBridge.getSnapshot().rejects.length
      setLoadingStep(copy.loadingStation)
      setLoadingProgress(42)
      stationBridge.send('station.openDemo', { id: stationId })

      await waitUntil(
        () => {
          const snap = stationBridge.getSnapshot()
          const st = useStore.getState()
          return snap.revision > prevRevision && st.station.cells.length > 0 && st.metrics !== null
        },
        90_000,
        copy.stationError,
        () => {
          const rejects = stationBridge.getSnapshot().rejects
          for (let i = prevRejectCount; i < rejects.length; i++) {
            if (rejects[i]?.type === 'station.openDemo') {
              return rejects[i]!.reason || copy.stationError
            }
          }
          return null
        },
      )

      setLoadingStep(copy.preparingScene)
      setLoadingProgress(64)
      stationBridge.send('sim.play', { playing: false })
      stationBridge.send('sim.speed', { speed: SPEED })

      const hideUI = view === 'regular' && stationId === 'tanwei'
      const hideGround = view === 'regular' && stationId === 'zoo'
      const currentStore = useStore.getState()
      currentStore.setHideUI(hideUI)
      currentStore.setHideGround(hideGround)
      currentStore.setGhostOther(true)
      stationBridge.send('view.set', { key: 'hideUi', value: hideUI })
      stationBridge.send('view.set', { key: 'ground', value: hideGround })
      stationBridge.send('view.set', { key: 'showLevels', value: true })

      // Mirror the exact /game/benchmark per-demo storeys and framing.
      if (view === 'regular' && stationId === 'zoo') {
        useStore.getState().setActiveZ(-15)
        stationBridge.send('view.set', { key: 'level', value: -15 })
      }
      if (view === 'regular' && stationId === 'tianhe') {
        useStore.getState().setActiveZ(-5)
        stationBridge.send('view.set', { key: 'level', value: -5 })
      }

      if (view === 'explode') {
        useStore.getState().setExplodedView(true)
        await waitUntil(
          () => {
            const dlg = document.querySelector('.explodedViewer')
            const exp = parseExplodedHostState(stationBridge.getSnapshot().state.exploded)
            return dlg?.getAttribute('data-ready') === 'true' && exp?.phase === 'ready' && exp?.equipped === true
          },
          60_000,
          copy.explodedError,
          () => {
            const exp = parseExplodedHostState(stationBridge.getSnapshot().state.exploded)
            return exp?.error || null
          },
        )
      } else {
        if (stationId === 'zoo') {
          stationBridge.send('camera.snap', { face: 'dir:-1,1,1', direction: [-1, 1, 1], projection: 'perspective' })
        }
        stationBridge.send('camera.zoom', { factor: 2 / 3 })
      }

      setLoadingProgress(82)
      setLoadingStep(copy.settling)
      await new Promise(resolve => window.setTimeout(resolve, 900))
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

      setLoadingProgress(100)
      setPhase('running')

      const frames: FrameSample[] = []
      const arrivals: ArrivalSample[] = []
      const resources: ResourceSample[] = []
      const memoryApi = performance as Performance & { memory?: { usedJSHeapSize?: number } }
      const initialMetrics = useStore.getState().metrics
      const initialTick = initialMetrics?.tick ?? 0
      let lastArrivals = initialMetrics?.trainArrivals ?? 0
      let displayedSecond = 30
      let lastFrame = performance.now()
      const started = lastFrame

      stationBridge.send('sim.speed', { speed: SPEED })
      const nativeRecorderStarted = await stationBridge.request<{ recording?: boolean }>('benchmark.start', {}).then(r => Boolean(r?.recording)).catch(() => false)
      stationBridge.send('sim.play', { playing: true })

      await new Promise<void>(resolve => {
        const sample = (): void => {
          const now = performance.now()
          const metrics = useStore.getState().metrics
          frames.push({ at: now - started, interval: now - lastFrame, tick: metrics?.tick ?? 0 })
          lastFrame = now

          const count = metrics?.trainArrivals ?? lastArrivals
          if (count > lastArrivals) arrivals.push({ at: now - started, tick: metrics?.tick ?? 0 })
          lastArrivals = count

          const elapsed = now - started
          if (elapsed >= resources.length * 1000 + 1000 || (resources.length === 0 && elapsed >= 1000)) {
            resources.push({
              at: elapsed,
              cpu: null,
              gpu: null,
              ram: Number.isFinite(memoryApi.memory?.usedJSHeapSize) ? memoryApi.memory!.usedJSHeapSize! / (1024 * 1024) : null,
            })
          }

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

      stationBridge.send('sim.play', { playing: false })
      const nativeStop = nativeRecorderStarted
        ? await stationBridge.request<NativeBenchmarkStop>('benchmark.stop', {}).catch(() => null)
        : null
      const finalTick = useStore.getState().metrics?.tick ?? initialTick
      const current = useStore.getState()
      const hw = nativeStop?.hardware
      const isDesktopRun = desktop || Boolean(hw?.isDesktop)
      const nativeFrames = parseNativeFrames(nativeStop?.frames)
      const measuredFrames = isDesktopRun && nativeFrames.length >= 2 ? nativeFrames : frames
      const nativeResources = Array.isArray(nativeStop?.resources)
        ? nativeStop.resources.filter(sample => sample && typeof sample.at === 'number')
        : []
      const hasNativeRam = nativeResources.some(sample => typeof sample.ram === 'number' && Number.isFinite(sample.ram))
      const measuredResources = isDesktopRun && hasNativeRam ? nativeResources : resources
      const nativeGpu = hw?.gpu ? `${hw.gpu}${hw.gpuApi ? ` (${hw.gpuApi})` : ''}` : ''
      const gpu = isDesktopRun && nativeGpu ? nativeGpu : readGpuRenderer(canvas, nativeGpu || copy.unavailable)
      const viewport = isDesktopRun && hw?.screenWidth && hw?.screenHeight
        ? `${hw.screenWidth} × ${hw.screenHeight}`
        : `${canvas.clientWidth} × ${canvas.clientHeight}`
      const runtimeLabel = isDesktopRun
        ? [hw?.engine, hw?.platform].filter(Boolean).join(' · ') || copy.unityDesktopEngine
        : browserLabel(navigator.userAgent)

      // Close exploded <dialog> so the results page is never hidden behind top-layer modal chrome.
      if (view === 'explode') useStore.getState().setExplodedView(false)

      const intervals = measuredFrames.slice(1).map(frame => frame.interval)
      const stats = summarizeFrameIntervals(intervals)
      if (!stats) throw new Error(copy.noFramesError)

      setResult({
        ticks: finalTick - initialTick,
        station: current.station.name,
        stationId,
        modelDetail,
        upscalingMode,
        upscalingBackend,
        isDesktop: isDesktopRun,
        nativeMemory: isDesktopRun && hasNativeRam,
        activeLevel: current.activeZ,
        view,
        frames: measuredFrames,
        arrivals,
        resources: measuredResources,
        stats,
        browser: isDesktopRun ? runtimeLabel : navigator.userAgent,
        runtimeLabel,
        gpu,
        cpuCores: (isDesktopRun && typeof hw?.cpuCores === 'number' ? hw.cpuCores : null) ?? (navigator.hardwareConcurrency || null),
        memoryGb: (isDesktopRun && typeof hw?.memoryGb === 'number' ? hw.memoryGb : null) ?? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null),
        viewport,
        pixelRatio: isDesktopRun ? 1 : window.devicePixelRatio,
        cells: current.station.cells.length,
        modules: current.station.modules.length,
      })
      setPhase('result')
    } catch (cause) {
      stationBridge.send('sim.play', { playing: false })
      void stationBridge.request('benchmark.stop', {}).catch(() => null)
      useStore.getState().setExplodedView(false)
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    } finally {
      const restore: Record<string, string> = {}
      if (savedDetail && savedDetail !== modelDetail) restore.profile = savedDetail
      if (savedUpscaling && savedUpscaling !== upscalingMode) restore.upscaling = savedUpscaling
      if (restore.profile || restore.upscaling) {
        stationBridge.send('graphics.set', restore)
      }
    }
  }

  const retry = (): void => {
    stationBridge.send('sim.play', { playing: false })
    useStore.getState().setExplodedView(false)
    setResult(null)
    setPhase('setup')
  }

  const nextLanguage: Language = language === 'en' ? 'zh-CN' : 'en'
  const languagePath = isBenchmarkPath(location.pathname)
    ? benchmarkLanguagePath(location.pathname, nextLanguage)
    : benchmarkHrefFor(location.pathname, nextLanguage)
  const toggleLanguage = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    setLanguage(nextLanguage)
    if (!desktop) {
      window.history.replaceState(null, '', `${languagePath}${location.search}${location.hash}`)
    }
  }

  const exitToGame = (): void => {
    stationBridge.send('sim.play', { playing: false })
    stationBridge.send('sim.speed', { speed: 1 })
    const st = useStore.getState()
    st.setExplodedView(false)
    if (st.hideUI) {
      st.setHideUI(false)
      stationBridge.send('view.set', { key: 'hideUi', value: false })
    }
    onExit?.()
  }

  return <>
    {app}
    {phase !== 'preparing' && phase !== 'running' && <nav className="benchmarkLocale">
      {onExit && <button type="button" onClick={exitToGame}>{copy.backToGame}</button>}
      <a href={languagePath} onClick={toggleLanguage}>{copy.language}</a>
    </nav>}
    {phase === 'setup' && <main className="benchmarkPage"><section className="benchmarkSetup">
      <div className="benchmarkEyebrow">{copy.unityEyebrow}</div>
      <h1>{desktop ? copy.unityDesktopTitle : copy.unityTitle}</h1>
      <p>{desktop ? copy.unityDesktopIntro : copy.intro}</p>
      <label>{copy.station}<select value={stationId} onChange={event => setStationId(event.target.value as ExampleStationId)}>{UNITY_STATIONS.map(id => <option key={id} value={id}>{copy[id]}</option>)}</select></label>
      <fieldset><legend>{copy.modelDetail}</legend><div className="benchmarkChoices">
        {MODEL_DETAIL_PROFILES.map(profile => (
          <button key={profile} type="button" aria-pressed={modelDetail === profile} onClick={() => setModelDetail(profile)}>{detailLabels[profile]}</button>
        ))}
      </div></fieldset>
      <fieldset><legend>{copy.fsr}</legend>
        <div className="benchmarkChoices benchmarkFsrModes" role="group" aria-label={copy.fsr}>
          {FSR_MODES.map(mode => (
            <button key={mode} type="button" aria-pressed={upscalingMode === mode} onClick={() => setUpscalingMode(mode)}>{fsrLabels[mode]}</button>
          ))}
        </div>
      </fieldset>
      <fieldset><legend>{copy.view}</legend><div className="benchmarkChoices">
        <button type="button" aria-pressed={view === 'regular'} onClick={() => setView('regular')}>{copy.normal}</button>
        <button type="button" aria-pressed={view === 'explode'} onClick={() => setView('explode')}>{copy.explode}</button>
      </div></fieldset>
      <button className="benchmarkStart" type="button" onClick={() => void begin()}>{copy.start}</button>
      <small>{desktop ? copy.unityDesktopKeepVisible : copy.keepVisible}</small>
    </section></main>}
    {phase === 'preparing' && <section className="benchmarkLoadingScreen" role="status" aria-live="polite">
      <div className="benchmarkLoadingCard">
        <div className="benchmarkEyebrow">{copy.preparing}</div>
        <h1>{copy[stationId]}</h1>
        <p>{loadingStep || copy.loading}</p>
        <div className="benchmarkProgressTrack" role="progressbar" aria-label={copy.preparing} aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingProgress}>
          <span style={{ width: `${loadingProgress}%` }}/>
        </div>
        <div className="benchmarkLoadingMeta"><span>{loadingProgress}%</span><span>{copy.controlsLocked}</span></div>
      </div>
    </section>}
    {phase === 'running' && <aside ref={hudRef} popover={view === 'explode' ? 'manual' : undefined} className="benchmarkHud"><div><b>{copy.running}</b><span>{`${remaining}${copy.seconds} · ${copy[stationId]} · ${detailLabels[modelDetail]} · ${copy.fsr}: ${fsrLabels[upscalingMode]} · ${view === 'explode' ? copy.explode : copy.normal} · ${copy.controlsLocked}`}</span></div></aside>}
    {(phase === 'error' || phase === 'result') && <main className="benchmarkPage benchmarkResultsPage">
      {phase === 'error' ? <section className="benchmarkSetup"><h1>{copy.couldNotFinish}</h1><p role="alert">{error}</p><button type="button" className="benchmarkStart" onClick={retry}>{copy.back}</button></section> : result && <article className="benchmarkResult">
        <header className="benchmarkResultHeader"><div><div className="benchmarkEyebrow">{copy.first30}</div><h1>{stationLabel(result.stationId, language)}</h1><p>{result.isDesktop ? copy.unityDesktopEngine : copy.unityEngine} · {detailLabels[result.modelDetail]} · {copy.fsr}: {fsrLabels[result.upscalingMode]} · 16× · {result.runtimeLabel} / {result.gpu}</p></div><button type="button" onClick={retry}>{copy.again}</button></header>
        <div className="benchmarkMetricRow"><div><span>{copy.average}</span><strong>{result.stats.averageFps.toFixed(2)}</strong></div><div><span>{copy.low1}</span><strong>{result.stats.onePercentLowFps.toFixed(2)}</strong></div><div><span>{copy.worst}</span><strong>{result.stats.worstFrameMs.toFixed(0)} <small>ms</small></strong></div><div><span>{copy.view}</span><strong>{result.view === 'explode' ? copy.explode : copy.normal}</strong></div></div>
        <BenchmarkChart result={result} copy={copy}/>
        <section className="benchmarkResourceSection"><h2>{copy.resourceUsage}</h2><ResourceChart result={result} copy={copy}/></section>
        <section className="benchmarkHardware"><h2>{copy.hardware}</h2><dl>
          <div><dt>{copy.engine}</dt><dd>{result.isDesktop ? copy.unityDesktopEngine : copy.unityEngine}{result.upscalingBackend !== 'off' ? ` · ${result.upscalingBackend}` : ''}</dd></div><div><dt>{result.isDesktop ? copy.desktopRuntime : copy.browser}</dt><dd>{result.browser}</dd></div>
          <div><dt>{copy.gpu}</dt><dd>{result.gpu}</dd></div><div><dt>{copy.cores}</dt><dd>{result.cpuCores ?? copy.unavailable}</dd></div>
          <div><dt>{copy.memory}</dt><dd>{result.memoryGb ? `${result.memoryGb} GB` : copy.unavailable}</dd></div><div><dt>{copy.viewport}</dt><dd>{result.viewport} {copy.dpr} {result.pixelRatio.toFixed(2)}</dd></div>
          <div><dt>{copy.geometry}</dt><dd>{result.cells.toLocaleString()} {copy.cells} · {result.modules.toLocaleString()} {copy.modules}</dd></div>
          <div><dt>{copy.run}</dt><dd>{stationLabel(result.stationId, language)} · {detailLabels[result.modelDetail]} · {copy.fsr}: {fsrLabels[result.upscalingMode]} · {result.view === 'explode' ? copy.explode : copy.normal} · {copy.level} {result.activeLevel} m · {result.view === 'regular' ? `${copy.zoom} · ` : ''}16× · 30{copy.secShort} · {result.ticks.toLocaleString()} {copy.tick}</dd></div>
          <div><dt>{copy.samples}</dt><dd>{Math.max(0, result.frames.length - 1).toLocaleString()} {copy.intervals} · {result.arrivals.length} {copy.arrivals}</dd></div>
        </dl><p>{result.isDesktop ? copy.unityDesktopIntervalInfo : copy.unityIntervalInfo}</p></section>
      </article>}
    </main>}
  </>
}
