// Unity player shell (plan 11). The station document, camera, clock and tool
// state live in C#; this file mounts the shared React UI over the Unity canvas
// and is the only place that translates UI intent into `stationBridge` commands.
//
// The legacy Zoo slice keeps its own entry (`zooUi.tsx`) so the old
// `ZooPlayable` scene and its recorded smoke stay reproducible during the
// transition; `tools/unity-web/pack.mjs` attaches the entry for the built scene.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../app/windows/AppShell.tsx'
import { ViewCube } from '../app/ViewCube.tsx'
import type { ViewCubeAdapter } from '../app/ViewCubeAdapter.ts'
import { useStore } from '../app/store.ts'
import { initLanguage } from '../app/i18n.ts'
import { showGameLoading } from '../app/gameLoading.ts'
import { initUiTheme } from '../app/uiTheme.ts'
import { demoStationForPath, gamePathFor } from '../app/demoRoute.ts'
import type { StationHost } from '../app/windows/StationHost.tsx'
import { openingLevel } from '../app/openingLevel.ts'
import { parse } from '../persistence/save.ts'
import { attachCanvasCameraGestures, attachViewStateBridge, createStationCameraPort, createUnityViewCubeAdapter } from './cameraAdapter.ts'
import { createSignFacePort } from './signFaceProvider.ts'
import { applyUnityClock, createSimulationPort, simulationStoreActions } from './simulationAdapter.ts'
import type { UnityClock } from './simulationAdapter.ts'
import { stationBridge } from './stationBridge.ts'
import type { StationSnapshot } from './stationBridge.ts'
import { commitSignBoardsToHost, unityHostOwnsStation } from './signCommitAdapter.ts'
import { registerStationHostCommit } from '../app/stationHostBridge.ts'
import '../styles.css'
import './unity-ui.css'

const number = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null

function UnityViewport({ canvas, adapter }: { canvas: HTMLCanvasElement; adapter: ViewCubeAdapter }): React.ReactElement {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const stage = container.current
    if (!stage) return
    canvas.className = 'viewport'
    stage.appendChild(canvas)
    return () => { canvas.remove() }
  }, [canvas])
  return <div className="unityViewport" ref={container}><ViewCube adapter={adapter} /></div>
}

function UnityApp({ canvas, host, adapter }: { canvas: HTMLCanvasElement; host: StationHost; adapter: ViewCubeAdapter }): React.ReactElement {
  const snapshot = useSyncExternalStore(stationBridge.subscribe, stationBridge.getSnapshot)
  const state = snapshot.state
  const queued = number(state.queued, 0)
  const boarded = number(state.boarded, 0)
  return (
    <App
      viewport={<UnityViewport canvas={canvas} adapter={adapter} />}
      host={host}
      zooStatus={{ queued, boarded }}
      files={{ save: () => host.save(), open: document => host.openSave(document) }}
    />
  )
}

let loadingToken = 0

function dismissGameLoadingSoon(): void {
  const token = ++loadingToken
  const dismiss = (): void => {
    if (token !== loadingToken) return
    const screen = document.getElementById('game-loading')
    if (screen?.dataset.failed === 'true') return
    showGameLoading(false)
  }
  requestAnimationFrame(dismiss)
  window.setTimeout(dismiss, 60)
}

function runWithGameLoading(
  titleZh: string,
  titleEn: string,
  detailZh: string,
  detailEn: string,
  action: () => void,
): void {
  const token = ++loadingToken
  const english = document.documentElement.lang === 'en'
  const screen = document.getElementById('game-loading')
  const title = document.getElementById('loading-title')
  const detail = document.getElementById('loading-detail')
  if (screen) {
    delete screen.dataset.determinate
    delete screen.dataset.failed
    screen.style.removeProperty('--loading-progress')
  }
  if (title) title.textContent = english ? titleEn : titleZh
  if (detail) detail.textContent = english ? detailEn : detailZh
  showGameLoading(true)
  let ran = false
  const runOnce = (): void => {
    if (ran || token !== loadingToken) return
    ran = true
    action()
  }
  // Two frames let #game-loading paint before synchronous WebGL SendMessage
  // blocks the main thread; the timer covers backgrounded tabs.
  requestAnimationFrame(() => requestAnimationFrame(runOnce))
  window.setTimeout(runOnce, 80)
}

/**
 * Adopt a committed document into the shared store. The store is the UI's view
 * of the committed revision, never an edit buffer: a commit replaces it whole,
 * exactly as the C# transaction replaced the station.
 */
function adopt(snapshot: StationSnapshot): void {
  if (!snapshot.document || snapshot.documentRevision !== snapshot.revision) return
  const parsed = parse(snapshot.document)
  if (!parsed.ok) {
    loadingToken += 1
    showGameLoading(false)
    useStore.getState().setNotice(document.documentElement.lang === 'en' ? 'Could not read the committed station.' : '无法读取已提交的车站。')
    return
  }
  const state = snapshot.state
  const level = number(state.level, openingLevel(parsed.state))
  const speed = number(state.speed, 1)
  const running = state.playing === true || state.running === true || state.playing === 'true'
  useStore.setState({ station: parsed.state, activeZ: level, speed, playing: running })
  // A demo link is a start, not a location: once the document is committed the
  // URL becomes the plain game path so a reload restores the player's station
  // (`app/demoRoute.ts`). Applied only after a successful commit.
  if (demoStationForPath(location.pathname) !== null) {
    const url = new URL(location.href)
    url.pathname = gamePathFor(url.pathname)
    window.history.replaceState(null, '', url)
  }
  dismissGameLoadingSoon()
}

export function mountUnityUI(element: HTMLElement, canvas: HTMLCanvasElement): () => void {
  initLanguage()
  initUiTheme()
  // C# answers through one WebGL bridge call that dispatches this event with the
  // reply JSON; the transport stays outside the reducer so it can be tested.
  // Sign artwork requests travel on the same event and are answered here, so a
  // PNG never enters the document reducer (`signFaceProvider.ts`).
  const signFaces = createSignFacePort()
  const onState = (event: Event): void => {
    const detail = (event as CustomEvent<string>).detail
    if (!signFaces.receive(detail)) stationBridge.receive(detail)
  }
  window.addEventListener('metro:station-state', onState)
  const host: StationHost = {
    newStation: () => { stationBridge.send('station.new') },
    openDemo: id => {
      runWithGameLoading(
        '正在载入示例车站',
        'Loading example station',
        '正在构建示例车站，请稍候。',
        'Building the example station. Please wait.',
        () => { stationBridge.send('station.openDemo', { id }) },
      )
    },
    openSave: documentText => {
      runWithGameLoading(
        '正在载入存档',
        'Loading saved station',
        '正在打开存档并构建车站，请稍候。',
        'Opening your save and building the station. Please wait.',
        () => { stationBridge.send('station.open', { document: documentText }) },
      )
    },
    save: () => {
      // The last commit carries the whole committed save, so Save downloads that
      // text rather than asking the player to serialize again (plan 11 A6).
      const snapshot = stationBridge.getSnapshot()
      if (!snapshot.document) { stationBridge.send('station.save'); return }
      const name = text(snapshot.state.name) ?? 'station'
      const blob = new Blob([snapshot.document], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${name.replace(/[^\w\u4e00-\u9fff-]+/g, '-')}.metro.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      stationBridge.send('station.save')
    },
  }
  // Tool and level intent travel as session-scoped commands; neither edits the
  // document, so neither carries an expected revision.
  let previousTool = ''
  const toolOf = (): string => {
    const state = useStore.getState()
    if (state.tool === 'block') return 'floor'
    if (state.tool === 'module' && state.moduleType === 'gate') return 'gate'
    return state.tool === 'delete' ? 'delete' : state.tool === 'paint' ? 'paint' : 'inspect'
  }
  const unsubscribeTool = useStore.subscribe(() => {
    const tool = toolOf()
    if (tool === previousTool) return
    previousTool = tool
    stationBridge.send('tool.set', { tool })
  })
  let previousLevel = Number.NaN
  const unsubscribeLevel = useStore.subscribe(state => {
    if (state.activeZ === previousLevel) return
    previousLevel = state.activeZ
    stationBridge.send('view.set', { key: 'level', value: state.activeZ })
  })
  const stopAdopting = stationBridge.onCommit(adopt)
  let lastReject = stationBridge.getSnapshot().rejects.at(-1)
  const unsubscribeRejects = stationBridge.subscribe(() => {
    const latest = stationBridge.getSnapshot().rejects.at(-1)
    if (!latest || latest === lastReject) return
    lastReject = latest
    if (latest.type === 'station.open' || latest.type === 'station.openDemo' || latest.type === 'station.new' || latest.type === 'station.resync') {
      loadingToken += 1
      showGameLoading(false)
      const english = document.documentElement.lang === 'en'
      if (latest.type === 'station.open') {
        useStore.getState().setNotice(english ? 'Could not read the save file.' : '无法读取存档文件。')
      } else if (latest.type === 'station.openDemo') {
        useStore.getState().setNotice(english ? 'Could not open the example station.' : '无法打开示例车站。')
      }
    }
  })
  const existing = stationBridge.getSnapshot()
  if (existing.revision >= 0) adopt(existing)

  // One camera port owns canvas gestures, the ViewCube and Ctrl+H, so the C#
  // camera never sees the same pointer event twice (`cameraAdapter.ts`).
  const cameraPort = createStationCameraPort()
  const cameraAdapter = createUnityViewCubeAdapter(cameraPort)
  const detachCanvas = attachCanvasCameraGestures(canvas, cameraPort)
  // The 视图 folder, section controls and overlays are store state; this bridge
  // turns their changes into `view.set` commands (level is sent above).
  const detachView = attachViewStateBridge(cameraPort)

  // The session clock is C#'s; the store mirrors it so the time panels print the
  // player's time and the controls send `sim.*` instead of a worker message.
  const previousActions = useStore.getState()
  const simulationPort = createSimulationPort({
    send: command => { stationBridge.send(command.type, command.payload) },
  })
  useStore.setState(simulationStoreActions(simulationPort, useStore))
  const applyClock = (): void => {
    const clock = stationBridge.getSnapshot().state.clock as UnityClock | undefined
    if (!clock || !Number.isFinite(clock.simTimeSeconds)) { simulationPort.disconnect(); return }
    simulationPort.receiveClock(clock)
    applyUnityClock(useStore, clock)
  }
  const unsubscribeClock = stationBridge.subscribe(applyClock)
  applyClock()

  // Ask the host for its station once the player registers: a demo route names
  // the document to open, and any other path resumes whatever the host commits.
  const demo = demoStationForPath(location.pathname)
  queueMicrotask(() => {
    if (demo) stationBridge.send('station.openDemo', { id: demo })
    else stationBridge.send('station.resync')
  })

  const root = createRoot(element)
  root.render(<UnityApp canvas={canvas} host={host} adapter={cameraAdapter} />)
  // The committed snapshot is the player's public state; a browser check reads it
  // instead of scraping the DOM, and can drive the station through the same port
  // the UI uses (`verify-station-game.mjs`).
  ;(window as unknown as { __metroStationBridge?: typeof stationBridge }).__metroStationBridge = stationBridge
  // The sign editor's ✓ commits through the host while this shell owns the station;
  // the app registers no such port on its own (plan 11 F3 / `app/stationHostBridge.ts`).
  registerStationHostCommit({
    ownsStation: () => unityHostOwnsStation(),
    commitSignBoards: (moduleId, boards) => commitSignBoardsToHost(moduleId, boards),
  })
  return () => {
    registerStationHostCommit(null)
    stopAdopting()
    unsubscribeRejects()
    unsubscribeTool()
    unsubscribeLevel()
    unsubscribeClock()
    useStore.setState({
      setPlaying: previousActions.setPlaying, setSpeed: previousActions.setSpeed,
      restartSim: previousActions.restartSim, seekToDate: previousActions.seekToDate,
    })
    window.removeEventListener('metro:station-state', onState)
    signFaces.dispose()
    detachCanvas()
    detachView()
    cameraAdapter.dispose()
    cameraPort.dispose()
    root.unmount()
    stationBridge.unregister()
    const notice = text(stationBridge.getSnapshot().state.message)
    if (notice) useStore.getState().setNotice(notice)
  }
}

export { stationBridge }
