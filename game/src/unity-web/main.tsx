// Unity player shell (plan 11). The station document, camera, clock and tool
// state live in C#; this file mounts the shared React UI over the Unity canvas
// and is the only place that translates UI intent into `stationBridge` commands.
//
// The legacy Zoo slice keeps its own entry (`zooUi.tsx`) so the old
// `ZooPlayable` scene and its recorded smoke stay reproducible during the
// transition; `tools/unity-web/pack.mjs` attaches the entry for the built scene.
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../app/windows/AppShell.tsx'
import { ViewCube } from '../app/ViewCube.tsx'
import type { ViewCubeAdapter } from '../app/ViewCubeAdapter.ts'
import { useStore } from '../app/store.ts'
import { initLanguage } from '../app/i18n.ts'
import { msg } from '../sim/i18n.ts'
import { measurePosition, measureText, wantsMeasure, type CellsPayload } from './pointerMeasure.ts'
import { showGameLoading } from '../app/gameLoading.ts'
import { initUiTheme } from '../app/uiTheme.ts'
import { demoStationForPath, gamePathFor } from '../app/demoRoute.ts'
import type { StationHost } from '../app/windows/StationHost.tsx'
import { openingLevel } from '../app/openingLevel.ts'
import { parse } from '../persistence/save.ts'
import { attachCanvasCameraGestures, attachViewStateBridge, createStationCameraPort, createUnityViewCubeAdapter } from './cameraAdapter.ts'
import { attachCanvasToolPointer } from './pointerInput.ts'
import { createToolAdapter, rightClaimedByTool } from './toolAdapter.ts'
import { noticeKey, noticeText, type BuildOutcome } from './editNotices.ts'
import { UnityExplodedView } from './UnityExplodedView.tsx'
import { paletteIdForModule } from '../app/tools/PickTool.ts'
import { createSignFacePort } from './signFaceProvider.ts'
import { createPsdHeaderPort } from './psdHeaderProvider.ts'
import { createExitFacePort } from './exitFaceProvider.ts'
import { createCalligraphyFacePort } from './calligraphyFaceProvider.ts'
import { attachKeyboardNavigation } from './keyboardNavigation.ts'
import { applyUnityClock, bindSimulationPort, createSimulationPort, receiveHostState, simulationStoreActions } from './simulationAdapter.ts'
import { applyHostStatistics, createStatisticsAdapter } from './statisticsAdapter.ts'
import { stationBridge } from './stationBridge.ts'
import type { StationSnapshot } from './stationBridge.ts'
import { applyStationDelta, seedStationCellIndex } from './stationDelta.ts'
import { commitSignBoardsToHost, unityHostOwnsStation } from './signCommitAdapter.ts'
import { registerStationHostCommit } from '../app/stationHostBridge.ts'
import { beginPointerDrag } from '../app/pointerDrag.ts'
import { mountUnityAudio } from './unityAudio.ts'
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
  return (
    <>
      <App
        viewport={<UnityViewport canvas={canvas} adapter={adapter} />}
        host={host}
        files={{ save: () => host.save(), open: document => host.openSave(document) }}
      />
      <UnityExplodedView canvas={canvas} />
    </>
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

let adoptedStoreRevision = -1
let adoptedStoreSession = ''

/**
 * Adopt a committed document or local delta into the shared store. The store is the
 * UI's view of the committed revision, never an edit buffer: full commits replace it
 * whole, and sequential local deltas patch only changed/removed records (plan 32 §F).
 */
function adopt(snapshot: StationSnapshot): void {
  if (snapshot.resyncNeeded) return
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (snapshot.document && snapshot.documentRevision === snapshot.revision) {
    const parsed = parse(snapshot.document)
    if (!parsed.ok) {
      loadingToken += 1
      showGameLoading(false)
      useStore.getState().setNotice(document.documentElement.lang === 'en' ? 'Could not read the committed station.' : '无法读取已提交的车站。')
      return
    }
    seedStationCellIndex(parsed.state.cells)
    const state = snapshot.state
    const level = number(state.level, openingLevel(parsed.state))
    const speed = number(state.speed, 1)
    const running = state.playing === true || state.running === true || state.playing === 'true'
    useStore.setState({ station: parsed.state, activeZ: level, speed, playing: running })
    adoptedStoreRevision = snapshot.revision
    adoptedStoreSession = snapshot.sessionId
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    stationBridge.noteAdopted(snapshot.revision, t1 - t0)
    // A demo link is a start, not a location: once the document is committed the
    // URL becomes the plain game path so a reload restores the player's station
    // (`app/demoRoute.ts`). Applied only after a successful commit.
    if (demoStationForPath(location.pathname) !== null) {
      const url = new URL(location.href)
      url.pathname = gamePathFor(url.pathname)
      window.history.replaceState(null, '', url)
    }
    dismissGameLoadingSoon()
    return
  }

  const delta = snapshot.delta
  if (delta && delta.revision === snapshot.revision) {
    if (adoptedStoreSession !== snapshot.sessionId || adoptedStoreRevision !== delta.baseRevision) {
      stationBridge.resync()
      return
    }
    const prevStation = useStore.getState().station
    const nextStation = applyStationDelta(prevStation, delta)
    const state = snapshot.state
    const level = number(state.level, useStore.getState().activeZ)
    const speed = number(state.speed, 1)
    const running = state.playing === true || state.running === true || state.playing === 'true'
    useStore.setState({ station: nextStation, activeZ: level, speed, playing: running })
    adoptedStoreRevision = snapshot.revision
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    stationBridge.noteAdopted(snapshot.revision, t1 - t0)
  }
}

/**
 * The one mounted Unity shell. Plan 29 §4: two React trees over the same player would each
 * draw a ViewCube and a depth rail — two chips with two different `activeZ` values over one
 * selected tick — so a second mount replaces the previous tree instead of stacking on it.
 */
let activeShell: { element: HTMLElement; unmount: () => void } | null = null

export function mountUnityUI(element: HTMLElement, canvas: HTMLCanvasElement): () => void {
  if (activeShell) {
    const previous = activeShell
    activeShell = null
    try { previous.unmount() } catch { /* the old tree may already be detaching */ }
  }
  initLanguage()
  initUiTheme()
  const unmountAudio = mountUnityAudio()
  // C# answers through one WebGL bridge call that dispatches this event with the
  // reply JSON; the transport stays outside the reducer so it can be tested.
  // Sign artwork requests travel on the same event and are answered here, so a
  // PNG never enters the document reducer (`signFaceProvider.ts`). PSD header
  // panels (RCA 15 §5) take the same route through their own painter, for the
  // same reason. Street exit/guidepost plates (plan 16 §5.3) are the third kind,
  // and station-name inscriptions (plan 30 §4) the fourth: their glyphs are the
  // six approved hands in `sim/calligraphyFonts.ts`, not Unity's one scene font.
  const signFaces = createSignFacePort()
  const psdHeaders = createPsdHeaderPort()
  const exitFaces = createExitFacePort()
  const calligraphyFaces = createCalligraphyFacePort()
  const onState = (event: Event): void => {
    const detail = (event as CustomEvent<string>).detail
    if (signFaces.receive(detail)) return
    if (psdHeaders.receive(detail)) return
    if (exitFaces.receive(detail)) return
    if (calligraphyFaces.receive(detail)) return
    stationBridge.receive(detail)
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
      const downloadText = (docText: string, stationName: string): void => {
        const blob = new Blob([docText], { type: 'application/json;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${stationName.replace(/[^\w\u4e00-\u9fff-]+/g, '-')}.metro.json`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        useStore.getState().setNotice(msg('saved'))
      }
      const snapshot = stationBridge.getSnapshot()
      const name = text(snapshot.state.name) ?? useStore.getState().station.name ?? 'station'
      if (snapshot.document && snapshot.documentRevision === snapshot.revision) {
        downloadText(snapshot.document, name)
        stationBridge.send('station.save')
        return
      }
      void stationBridge.readCommittedDocument().then(docText => {
        if (!docText) throw new Error('No committed document')
        downloadText(docText, name)
      }).catch(() => {
        useStore.getState().setNotice(msg('station_save_failed'))
      })
    },
  }
  // Tool and level intent travel as session-scoped commands; neither edits the
  // document, so neither carries an expected revision. The typed adapter owns the
  // canonical names and the whole settings payload: the host resolves a ghost from the
  // same palette id / turn / cut mode the rail is showing (`toolAdapter.ts`, plan 27 §2).
  const toolAdapter = createToolAdapter({
    read: () => useStore.getState(),
    send: (tool, settings) => { stationBridge.send('tool.set', { tool, settings }) },
    subscribe: listener => useStore.subscribe(listener),
    applyHostTool: tool => { useStore.getState().setTool(tool) },
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
    } else if (latest.type.startsWith('sim.')) {
      // The host refused a transport command (`no-session`, `unsupported-speed`, …):
      // say so, because the button that sent it otherwise looks like it did nothing.
      const english = document.documentElement.lang === 'en'
      useStore.getState().setNotice(english
        ? `The simulation refused that command (${latest.code}).`
        : `仿真拒绝了该操作（${latest.code}）。`)
    } else if (latest.reason && /^(sign\.|road\.|face\.|tool\.)/.test(latest.type)) {
      // An edit verb the player drove was refused, and the host said why: surface its
      // sentence rather than leaving the control that sent it looking inert. Camera and
      // view refusals during the first commit are the shell's own early sends, not the
      // player's, so they stay silent.
      useStore.getState().setNotice(latest.reason)
    }
  })
  const existing = stationBridge.getSnapshot()
  if (existing.revision >= 0) adopt(existing)

  // One camera port owns canvas gestures, the ViewCube and Ctrl+H, so the C#
  // camera never sees the same pointer event twice (`cameraAdapter.ts`).
  const cameraPort = createStationCameraPort()
  const cameraAdapter = createUnityViewCubeAdapter(cameraPort)
  // The committed tool can claim the secondary mouse button (the block brush digs with it);
  // the host publishes that as `state.rightClaim`, and both canvas owners read the one value
  // so a right press is never delivered to the camera and the tool (`pointerInput.ts`).
  const rightClaimed = (): boolean => rightClaimedByTool(stationBridge.getSnapshot().state.rightClaim)
  const detachCanvas = attachCanvasCameraGestures(canvas, cameraPort, {
    blocked: () => document.body.dataset.metroBenchmarkLocked === 'true' || useStore.getState().explodedView || useStore.getState().followAgentId !== null,
    claimsRight: rightClaimed,
  })
  // The tool pointer stream, on the same canvas and with the same capture rule: a press on a
  // React panel never reaches it. C# resolves one hit per event and dispatches a release to
  // the gesture owner recorded at the press.
  // The pointer's drag size label (`cells.measure`). C# publishes the footprint badge for a
  // live cell plan; this chip is the only part that draws it, so the rule lives in
  // `pointerMeasure.ts` and the player sees the size it is dragging.
  const measureChip = document.createElement('div')
  measureChip.className = 'metro-measure-chip'
  measureChip.hidden = true
  ;(canvas.parentElement ?? canvas).appendChild(measureChip)
  let pointerAt = { clientX: 0, clientY: 0 }
  const trackPointer = (event: PointerEvent): void => {
    pointerAt = { clientX: event.clientX, clientY: event.clientY }
  }
  canvas.addEventListener('pointermove', trackPointer, { passive: true })
  const showMeasure = (cells: CellsPayload | null): void => {
    const english = document.documentElement.lang === 'en'
    const label = wantsMeasure(cells) ? measureText(cells, english ? 'en' : 'zh') : ''
    if (!label) { measureChip.hidden = true; return }
    const at = measurePosition(pointerAt.clientX, pointerAt.clientY, canvas.getBoundingClientRect())
    measureChip.textContent = label
    measureChip.style.left = `${at.left}px`
    measureChip.style.top = `${at.top}px`
    measureChip.hidden = false
  }
  const detachPointer = attachCanvasToolPointer(canvas, undefined, {
    blocked: () => {
      const state = useStore.getState()
      if (document.body.dataset.metroBenchmarkLocked === 'true') return true
      return state.explodedView || state.signEditorFor !== null || state.signComposing || state.followAgentId !== null
    },
    claimsRight: rightClaimed,
  })
  // WASD and Ctrl+Q/E are the two keys the Three viewport's own scene owns; in the
  // Unity player they become held intents on the bridge, and the C# rig integrates
  // them (`keyboardNavigation.ts`). Space, plain Q/E, Ctrl+H and every tool key stay
  // with `AppShell`'s single handler, so no key has two owners.
  const detachKeyboard = attachKeyboardNavigation(cameraPort, {
    blocked: () => {
      const state = useStore.getState()
      if (document.body.dataset.metroBenchmarkLocked === 'true') return true
      return state.explodedView || state.signEditorFor !== null || state.signComposing || state.followAgentId !== null
    },
  })
  // The 视图 folder, section controls and overlays are store state; this bridge
  // turns their changes into `view.set` commands (level is sent above, and
  // `UnityExplodedView` owns `exploded.open` / `exploded.close`).
  const detachView = attachViewStateBridge(cameraPort, { forwardExploded: false })
  let stopEyeDrag: (() => void) | null = null
  let acknowledgedEye: number | null = null
  const detachEyeState = stationBridge.subscribe(() => {
    const state = useStore.getState()
    const view = stationBridge.getSnapshot().state.view as { followPassenger?: number } | undefined
    if (state.followAgentId !== null && view?.followPassenger === state.followAgentId) {
      acknowledgedEye = state.followAgentId
    } else if (state.followAgentId !== null && acknowledgedEye === state.followAgentId && view?.followPassenger === -1) {
      state.endPassengerView()
    }
    if (useStore.getState().followAgentId === null) {
      acknowledgedEye = null
      stopEyeDrag?.()
    }
  })
  const exitEye = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || useStore.getState().followAgentId === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    useStore.getState().endPassengerView()
  }
  const beginEyeDrag = (event: PointerEvent): void => {
    if (event.button !== 0 || stopEyeDrag || useStore.getState().followAgentId === null) return
    let lastX = event.clientX
    let lastY = event.clientY
    stopEyeDrag = beginPointerDrag(event, {
      capture: canvas,
      updateOnUp: false,
      onMove: (clientX, clientY) => {
        if (useStore.getState().followAgentId === null) {
          stopEyeDrag?.()
          return
        }
        const dx = clientX - lastX
        const dy = clientY - lastY
        lastX = clientX
        lastY = clientY
        if (dx === 0 && dy === 0) return
        cameraPort.send({ type: 'camera.orbit', payload: { dx, dy } })
      },
      onEnd: () => { stopEyeDrag = null },
    })
  }
  window.addEventListener('keydown', exitEye, true)
  canvas.addEventListener('pointerdown', beginEyeDrag)

  // The session clock is C#'s; the store mirrors it so the time panels print the
  // player's time and the controls send `sim.*` instead of a worker message.
  const previousActions = useStore.getState()
  const simulationPort = createSimulationPort({
    send: command => { stationBridge.send(command.type, command.payload) },
  })
  useStore.setState(simulationStoreActions(simulationPort, useStore))
  // Bound before the first render so the shared playback controls can disable what
  // this host cannot honour instead of binding a click that is only dropped.
  bindSimulationPort(simulationPort)
  // The clock and its capabilities arrive as one `state` payload: a clock without the
  // transport flags made Play and every speed button dead (plan 13 §1).
  const applyClock = (): void => {
    const clock = receiveHostState(simulationPort, stationBridge.getSnapshot().state)
    if (!clock) { simulationPort.disconnect(); return }
    applyUnityClock(useStore, clock)
  }
  const unsubscribeClock = stationBridge.subscribe(applyClock)
  applyClock()

  const statisticsAdapter = createStatisticsAdapter(useStore, {
    requestHistory: query => stationBridge.request('stats.history', query),
  })
  const applyStatistics = (): void => {
    applyHostStatistics(statisticsAdapter, stationBridge.getSnapshot())
  }
  const unsubscribeStatistics = stationBridge.subscribe(applyStatistics)
  const stopResyncStatistics = stationBridge.onCommit(committed => {
    applyHostStatistics(statisticsAdapter, committed, { resync: true })
  })
  applyStatistics()

  // The committed tool is C#'s (plan 11 A6). A `tool.set` that arrives from outside the
  // rail (a verifier, the desktop presenter, a second client) must move the shell's store
  // too, otherwise a delayed adoption (the eyedropper arming the rail) re-asserts its old
  // tool and silently overrides the host between a command and the pointer event it was
  // meant for. The adapter guards the echo, so the adoption never replaces the host's own
  // settings.
  const syncHostTool = (): void => {
    toolAdapter.adoptHostTool(stationBridge.getSnapshot().state.tool)
  }
  const unsubscribeHostTool = stationBridge.subscribe(syncHostTool)
  syncHostTool()

  // The C# pointer router publishes its selection and its eyedropper result in
  // `state.edit`. Adopting them through the same store actions the 选择/吸取 tools use
  // keeps the inspector and the Unity picking on one selection, and arms the rail with
  // the tile `paletteIdForModule` names for the picked record — the TypeScript mapping
  // stays the one owner of "which tile placed this piece".
  let lastSelection = ''
  let lastPick = ''
  let lastPaintPick = ''
  let lastNotice = ''
  const adoptEdit = (): void => {
    const state = stationBridge.getSnapshot().state
    const edit = state.edit as Record<string, unknown> | null | undefined
    showMeasure((edit?.cells as CellsPayload | null | undefined) ?? null)
    if (!edit) return
    // The pointer router's **build outcome** (`state.edit.notice`, plan 28 §4): a press the
    // surface refused, a click that deliberately changed nothing, or a stale gesture. The host
    // sends a code; the shell owns the player's language (`editNotices.ts`). One notice per
    // distinct outcome, so a held pointer over awkward geometry is not a toast storm.
    const outcome = (edit.notice as BuildOutcome | null | undefined) ?? null
    const outcomeKey = noticeKey(outcome)
    if (outcomeKey && outcomeKey !== lastNotice) {
      lastNotice = outcomeKey
      const english = document.documentElement.lang === 'en'
      const sentence = noticeText(outcome, english ? 'en' : 'zh-CN')
      if (sentence) useStore.getState().setNotice(sentence)
    } else if (!outcomeKey) {
      lastNotice = ''
    }
    const kind = typeof edit.selectionKind === 'string' ? edit.selectionKind : ''
    const key = typeof edit.selectionKey === 'string' ? edit.selectionKey : ''
    const label = typeof edit.selectionLabel === 'string' ? edit.selectionLabel : ''
    if ((kind === 'module' || kind === 'cell' || kind === 'agent') && key) {
      if (`${kind}|${key}` !== lastSelection) {
        lastSelection = `${kind}|${key}`
        useStore.getState().select({ kind, key, label: kind === 'agent' ? msg('passenger_value', Number(key)) : label })
      }
    } else if (lastSelection) {
      lastSelection = ''
      useStore.getState().select(null)
    }
    const pick = edit.pick as Record<string, unknown> | null | undefined
    const pickId = pick && typeof pick.moduleId === 'string' ? pick.moduleId : ''
    if (pickId && pickId !== lastPick) {
      lastPick = pickId
      const picked = useStore.getState().station.modules.find(module => module.id === pickId)
      const optionId = picked ? paletteIdForModule(picked) : null
      // Only arm the rail while the eyedropper is still the committed tool: a pick result
      // that arrives after the player (or the presenter) moved on must not drag the tool
      // back to 设备.
      if (picked && optionId !== null && useStore.getState().tool === 'pick') {
        const tools = useStore.getState()
        tools.beginPick()
        tools.setModuleType(optionId)
        if (typeof picked.rot === 'number') tools.setModuleRot(picked.rot)
        if (picked.type === 'light') tools.setLightPosition(picked.cfg.position ?? 0)
        if (picked.type === 'floor-mark' && picked.cfg.variant === 'direction' && picked.cfg.line) tools.setRailLine(picked.cfg.line)
        if (picked.type === 'gate') tools.setGateDoor(picked.cfg.door ?? 'lane')
        tools.setTool('module')
      }
    }
    if (!pickId) lastPick = ''
    // The 材质 brush's 取色 is the host's: `state.edit.paintPick` carries the finish of the face
    // the player eyedropped, and only while the brush is still armed with the eyedropper — a
    // late result must not drag the moulding brush back into pick mode.
    const paintPick = edit.paintPick as Record<string, unknown> | null | undefined
    const pickedFinish = paintPick && typeof paintPick.finish === 'string' ? paintPick.finish : ''
    const paintKey = pickedFinish ? `${pickedFinish}|${String(paintPick?.cell ?? '')}` : ''
    if (paintKey && paintKey !== lastPaintPick) {
      lastPaintPick = paintKey
      const tools = useStore.getState()
      if (tools.tool === 'paint' && tools.paintMode === 'pick' && pickedFinish) {
        tools.setPaintFinish(pickedFinish as never)
        tools.resumePaintMode()
      }
    } else if (!paintKey) {
      lastPaintPick = ''
    }
  }
  const unsubscribeEdit = stationBridge.subscribe(adoptEdit)
  adoptEdit()

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
  // The same port carries the document verbs whose only writer is the host (plan 27 §4), so
  // Ctrl+Z/Y, Delete and Escape reach the one edit history instead of a shadow store copy.
  registerStationHostCommit({
    ownsStation: () => unityHostOwnsStation(),
    commitSignBoards: (moduleId, boards) => commitSignBoardsToHost(moduleId, boards),
    commitExit: (moduleId, patch) => {
      stationBridge.send('edit.exit', { moduleId, ...patch })
      return true
    },
    undo: () => { stationBridge.send('edit.undo', {}); return true },
    redo: () => { stationBridge.send('edit.redo', {}); return true },
    deleteSelection: () => {
      const state = stationBridge.getSnapshot().state
      const edit = state.edit as Record<string, unknown> | null | undefined
      const kind = typeof edit?.selectionKind === 'string' ? edit.selectionKind : ''
      const key = typeof edit?.selectionKey === 'string' ? edit.selectionKey : ''
      if (!key) return false
      if (kind === 'module') {
        stationBridge.send('edit.delete', { moduleId: key })
        return true
      }
      if (kind === 'cell') {
        const parts = key.split(',').map(value => Number(value))
        if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return false
        stationBridge.send('edit.delete', { cell: parts, singleCell: true })
        return true
      }
      return false
    },
    cancelGesture: () => {
      const draft = useStore.getState().pickDraft
      if (!draft) stationBridge.send('edit.cancel', {})
      else void stationBridge.request<{ cancelled?: boolean }>('edit.cancel', {}).then(({ cancelled }) => {
        const state = useStore.getState()
        if (!cancelled && state.pickDraft === draft) state.cancelPick()
      }).catch(() => {})
      return true
    },
    confirmMove: () => {
      const edit = stationBridge.getSnapshot().state.edit as Record<string, unknown> | undefined
      if (!edit?.carried) return false
      stationBridge.send('edit.move.confirm', {})
      return true
    },
    rotateCarried: () => {
      const edit = stationBridge.getSnapshot().state.edit as Record<string, unknown> | undefined
      if (!edit?.carried) return false
      stationBridge.send('edit.rotate', { delta: -1 })
      return true
    },
    cycleCarriedLightPosition: () => {
      const edit = stationBridge.getSnapshot().state.edit as Record<string, unknown> | undefined
      const state = useStore.getState()
      const light = edit?.carried && state.station.modules.some(module => module.id === edit.carried && module.type === 'light')
      if (!light) return false
      stationBridge.send('edit.move.lightPosition', {})
      return true
    },
  })
  const unmount = (): void => {
    if (activeShell !== null && activeShell.unmount === unmount) activeShell = null
    registerStationHostCommit(null)
    stopAdopting()
    unmountAudio()
    unsubscribeRejects()
    toolAdapter.dispose()
    unsubscribeLevel()
    unsubscribeClock()
    stopResyncStatistics()
    unsubscribeStatistics()
    statisticsAdapter.disconnect()
    unsubscribeEdit()
    unsubscribeHostTool()
    bindSimulationPort(null)
    useStore.setState({
      setPlaying: previousActions.setPlaying, setSpeed: previousActions.setSpeed,
      restartSim: previousActions.restartSim, seekToDate: previousActions.seekToDate,
    })
    window.removeEventListener('metro:station-state', onState)
    signFaces.dispose()
    psdHeaders.dispose()
    exitFaces.dispose()
    calligraphyFaces.dispose()
    detachCanvas()
    detachPointer()
    canvas.removeEventListener('pointermove', trackPointer)
    measureChip.remove()
    detachKeyboard()
    detachView()
    detachEyeState()
    stopEyeDrag?.()
    window.removeEventListener('keydown', exitEye, true)
    canvas.removeEventListener('pointerdown', beginEyeDrag)
    cameraAdapter.dispose()
    cameraPort.dispose()
    root.unmount()
    stationBridge.unregister()
    const notice = text(stationBridge.getSnapshot().state.message)
    if (notice) useStore.getState().setNotice(notice)
  }
  activeShell = { element, unmount }
  return unmount
}

export { stationBridge }
