// Unity player shell (plan 11). The station document, camera, clock and tool
// state live in C#; this file mounts the shared React UI over the Unity canvas
// and is the only place that translates UI intent into `stationBridge` commands.
//
// The legacy Zoo slice keeps its own entry (`zooUi.tsx`) so the old
// `ZooPlayable` scene and its recorded smoke stay reproducible during the
// transition; `tools/unity-web/pack.mjs` attaches the entry for the built scene.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../app/windows/AppShell.tsx'
import { ViewCube } from '../app/ViewCube.tsx'
import type { ViewCubeAdapter } from '../app/ViewCubeAdapter.ts'
import { useStore } from '../app/store.ts'
import { getLanguage, initLanguage } from '../app/i18n.ts'
import { isBenchmarkPath } from '../app/languageRoute.ts'
import { msg } from '../sim/i18n.ts'
import { measurePosition, measureText, wantsMeasure, type CellsPayload } from './pointerMeasure.ts'
import { showGameLoading } from '../app/gameLoading.ts'
import { getUiTheme, initUiTheme, subscribeUiTheme } from '../app/uiTheme.ts'
import { demoStationForPath, gamePathFor } from '../app/demoRoute.ts'
import type { StationHost } from '../app/windows/StationHost.tsx'
import { openingLevel } from '../app/openingLevel.ts'
import { parse } from '../persistence/save.ts'
import { attachCanvasCameraGestures, attachViewStateBridge, createStationCameraPort, createUnityViewCubeAdapter } from './cameraAdapter.ts'
import { attachCanvasToolPointer } from './pointerInput.ts'
import { createToolAdapter, rightClaimedByTool } from './toolAdapter.ts'
import { noticeKey, noticeText, type BuildOutcome } from './editNotices.ts'
import { UnityExplodedView } from './UnityExplodedView.tsx'
import { UnityBenchmarkRoute } from './UnityBenchmarkRoute.tsx'
import { paletteIdForModule } from '../app/tools/PickTool.ts'
import { signBoardsOf } from '../sim/sign.ts'
import { createSignFacePort } from './signFaceProvider.ts'
import { createPsdHeaderPort } from './psdHeaderProvider.ts'
import { createExitFacePort } from './exitFaceProvider.ts'
import { createCalligraphyFacePort } from './calligraphyFaceProvider.ts'
import { createTrainMarkPort } from './trainMarkProvider.ts'
import { attachKeyboardNavigation } from './keyboardNavigation.ts'
import { applyUnityClock, bindSimulationPort, createSimulationPort, receiveHostState, simulationStoreActions } from './simulationAdapter.ts'
import { applyHostStatistics, createStatisticsAdapter } from './statisticsAdapter.ts'
import { readHostHistory, stationBridge } from './stationBridge.ts'
import type { StationSnapshot } from './stationBridge.ts'
import { applyStationDelta, seedStationCellIndex } from './stationDelta.ts'
import { createWebGlAutosave, resolveWebGlStartupAction, type WebGlAutosaveController } from './webglAutosave.ts'
import { createLineSelectionTracker, type LineSelectionTracker } from './lineSelection.ts'
import { createCarriedMoveAdapter } from './carriedMoveAdapter.ts'
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
    return () => {
      const containerFallback = document.getElementById('unity-fullscreen-container')
      if (containerFallback) containerFallback.insertBefore(canvas, containerFallback.firstChild)
      else canvas.remove()
    }
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

function UnityShellRoot({
  canvas,
  host,
  adapter,
  desktop,
  initialBenchmark,
  registerToggle,
}: {
  canvas: HTMLCanvasElement
  host: StationHost
  adapter: ViewCubeAdapter
  desktop: boolean
  initialBenchmark: boolean
  registerToggle: (open: () => void) => void
}): React.ReactElement {
  const [benchmarkMode, setBenchmarkMode] = useState(initialBenchmark)
  useEffect(() => {
    registerToggle(() => {
      document.body.dataset.metroBenchmarkActive = 'true'
      window.dispatchEvent(new CustomEvent('metro:benchmark-mode', { detail: { active: true } }))
      setBenchmarkMode(true)
    })
  }, [registerToggle])
  const unityApp = <UnityApp canvas={canvas} host={host} adapter={adapter} />
  if (!benchmarkMode) return unityApp
  const exitBenchmark = (): void => {
    delete document.body.dataset.metroBenchmarkActive
    window.dispatchEvent(new CustomEvent('metro:benchmark-mode', { detail: { active: false } }))
    setBenchmarkMode(false)
    if (useStore.getState().station.cells.length === 0) {
      host.openDemo('zoo')
    }
  }
  return <UnityBenchmarkRoute canvas={canvas} app={unityApp} desktop={desktop} onExit={desktop ? exitBenchmark : undefined} />
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
let activeAutosave: WebGlAutosaveController | null = null
let activeLineSelection: LineSelectionTracker | null = null

function reconcileRailLineSelection(snapshot: StationSnapshot, lines: ReturnType<typeof useStore.getState>['station']['lines']): void {
  const tracker = activeLineSelection
  if (!tracker) return
  const result = tracker.reconcile({
    sessionId: snapshot.sessionId,
    stationEpoch: snapshot.stationEpoch,
    commitId: snapshot.lastCommitId ?? '',
    createdLineId: snapshot.lastCommitLineId ?? null,
    lines,
    currentRailLineId: useStore.getState().railLineId,
  })
  if (result.createdLine) {
    useStore.setState({
      railLineId: result.nextRailLineId,
      notice: msg('created_value_new_track_will_bind_automatically', result.createdLine.name),
    })
  } else if (result.changed) {
    useStore.setState({ railLineId: result.nextRailLineId })
  }
}

/**
 * Adopt a committed document or local delta into the shared store. The store is the
 * UI's view of the committed revision, never an edit buffer: full commits replace it
 * whole, and sequential local deltas patch only changed/removed records (plan 32 §F).
 */
function adopt(snapshot: StationSnapshot): void {
  if (snapshot.resyncNeeded) return
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const adoptionTarget = {
    commandId: snapshot.lastCommitId ?? '',
    sessionId: snapshot.sessionId,
    stationEpoch: snapshot.stationEpoch,
  }
  if (typeof snapshot.document === 'string' && snapshot.documentRevision === snapshot.revision) {
    const parsed = parse(snapshot.document)
    if (!parsed.ok) {
      loadingToken += 1
      showGameLoading(false)
      useStore.getState().setNotice(document.documentElement.lang === 'en' ? 'Could not read the committed station.' : '无法读取已提交的车站。')
      stationBridge.noteAdoptionFailed({
        ...adoptionTarget,
        revision: snapshot.revision,
      }, 'invalid-document')
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
    reconcileRailLineSelection(snapshot, parsed.state.lines)
    activeAutosave?.noteCommit({
      sessionId: snapshot.sessionId,
      revision: snapshot.revision,
      stationEpoch: snapshot.stationEpoch,
      sourceId: snapshot.sourceId,
      commandId: snapshot.lastCommitId ?? null,
      documentText: snapshot.document,
    })
    // A demo link is a start, not a location: once the document is committed the
    // URL becomes the plain game path so a reload restores the player's station
    // (`app/demoRoute.ts`). Applied only after a successful commit.
    if (demoStationForPath(location.pathname) !== null) {
      const url = new URL(location.href)
      url.pathname = gamePathFor(url.pathname)
      window.history.replaceState(null, '', url)
    }
    dismissGameLoadingSoon()
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    stationBridge.noteAdopted(snapshot.revision, t1 - t0, adoptionTarget)
    return
  }

  const delta = snapshot.delta
  if (delta && delta.revision === snapshot.revision) {
    if (adoptedStoreSession !== snapshot.sessionId || adoptedStoreRevision !== delta.baseRevision) {
      stationBridge.resync({
        beforeSend: ({ id }) => activeAutosave?.trackCommand(id, 'resync'),
        onCancel: id => activeAutosave?.noteReject(id),
      })
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
    reconcileRailLineSelection(snapshot, nextStation.lines)
    activeAutosave?.noteCommit({
      sessionId: snapshot.sessionId,
      revision: snapshot.revision,
      stationEpoch: snapshot.stationEpoch,
      sourceId: snapshot.sourceId,
      commandId: snapshot.lastCommitId ?? null,
      documentText: null,
      delta,
    })
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    stationBridge.noteAdopted(snapshot.revision, t1 - t0, adoptionTarget)
    return
  }

  if (adoptionTarget.commandId) {
    stationBridge.noteAdoptionFailed({
      ...adoptionTarget,
      revision: snapshot.revision,
    }, 'missing-document')
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
  const isBenchmark = isBenchmarkPath(location.pathname)
  if (isBenchmark) document.body.dataset.metroBenchmarkActive = 'true'
  else delete document.body.dataset.metroBenchmarkActive
  const desktopOverlay = Boolean((window as unknown as { __metroDesktopOverlay?: boolean }).__metroDesktopOverlay) ||
    document.documentElement.classList.contains('metro-overlay')
  initLanguage()
  if (!isBenchmark || desktopOverlay) initUiTheme()
  const unmountAudio = isBenchmark && !desktopOverlay ? () => {} : mountUnityAudio()
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
  const trainMarks = createTrainMarkPort()
  const onState = (event: Event): void => {
    const detail = (event as CustomEvent<string>).detail
    if (signFaces.receive(detail)) return
    if (psdHeaders.receive(detail)) return
    if (exitFaces.receive(detail)) return
    if (calligraphyFaces.receive(detail)) return
    if (trainMarks.receive(detail)) return
    stationBridge.receive(detail)
  }
  window.addEventListener('metro:station-state', onState)
  let openDesktopBenchmark: (() => void) | null = null
  let startupCancelled = false
  // WebGL autosave (plan 37 §6.3, plan 39 §3 & §4): disabled on desktop overlay
  // (native presenter owns it) and on benchmark routes. Created before host
  // actions and reject listeners so every station-load command ID is correlated.
  let webglStorage: Storage | null = null
  try { webglStorage = typeof localStorage !== 'undefined' ? localStorage : null } catch { webglStorage = null }
  const autosave = createWebGlAutosave({
    enabled: !desktopOverlay && !isBenchmark,
    storage: webglStorage,
    onSequenceBroken: () => {
      stationBridge.resync({
        beforeSend: ({ id }) => autosave.trackCommand(id, 'resync'),
        onCancel: id => autosave.noteReject(id),
      })
    },
  })
  activeAutosave = autosave
  const lineSelection = createLineSelectionTracker()
  activeLineSelection = lineSelection
  let cachedHistory = readHostHistory(stationBridge.getSnapshot())
  const getHostHistory = (): { canUndo: boolean; canRedo: boolean } => {
    const next = readHostHistory(stationBridge.getSnapshot())
    if (next.canUndo !== cachedHistory.canUndo || next.canRedo !== cachedHistory.canRedo) {
      cachedHistory = next
    }
    return cachedHistory
  }
  const sendHistoryStep = (type: 'edit.undo' | 'edit.redo'): void => {
    const rev = stationBridge.getSnapshot().revision
    stationBridge.send(type, {}, rev >= 0 ? { expectedRevision: rev } : {})
  }
  const host: StationHost = {
    openBenchmark: desktopOverlay ? () => { openDesktopBenchmark?.() } : undefined,
    undo: () => { sendHistoryStep('edit.undo') },
    redo: () => { sendHistoryStep('edit.redo') },
    getHistory: getHostHistory,
    subscribeHistory: listener => stationBridge.subscribe(listener),
    modelDetail: async profile => {
      const result = profile === undefined
        ? await stationBridge.request('graphics.get')
        : await stationBridge.request('graphics.set', { profile })
      const applied = result.profile
      if (applied === 'high' || applied === 'balanced' || applied === 'low') return applied
      throw new Error('Invalid model detail reply')
    },
    upscaling: async mode => {
      const result = mode === undefined
        ? await stationBridge.request('graphics.get')
        : await stationBridge.request('graphics.set', { upscaling: mode })
      const applied = result.upscaling
      if (applied === 'native' || applied === 'ultra' || applied === 'quality' || applied === 'balanced' || applied === 'performance') return applied
      throw new Error('Invalid upscaling reply')
    },
    newStation: () => {
      startupCancelled = true
      stationBridge.send('station.new', undefined, {
        beforeSend: ({ id }) => autosave.trackCommand(id, 'replace'),
        onCancel: id => autosave.noteReject(id),
      })
    },
    openDemo: id => {
      startupCancelled = true
      runWithGameLoading(
        '正在载入示例车站',
        'Loading example station',
        '正在构建示例车站，请稍候。',
        'Building the example station. Please wait.',
        () => {
          stationBridge.send('station.openDemo', { id }, {
            beforeSend: ({ id: cmdId }) => autosave.trackCommand(cmdId, 'replace'),
            onCancel: cmdId => autosave.noteReject(cmdId),
          })
        },
      )
    },
    openSave: documentText => {
      startupCancelled = true
      runWithGameLoading(
        '正在载入存档',
        'Loading saved station',
        '正在打开存档并构建车站，请稍候。',
        'Opening your save and building the station. Please wait.',
        () => {
          stationBridge.send('station.open', { document: documentText }, {
            beforeSend: ({ id: cmdId }) => autosave.trackCommand(cmdId, 'replace'),
            onCancel: cmdId => autosave.noteReject(cmdId),
          })
        },
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
    const currentSnap = stationBridge.getSnapshot()
    lineSelection.syncFence(currentSnap.sessionId, currentSnap.stationEpoch)
    const latest = currentSnap.rejects.at(-1)
    if (!latest || latest === lastReject) return
    lastReject = latest
    autosave.noteReject(latest.id)
    lineSelection.noteReject(latest.id)
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
    } else if (latest.code === 'revision-mismatch' || latest.code === 'stale-revision') {
      stationBridge.resync({
        beforeSend: ({ id }) => autosave.trackCommand(id, 'resync'),
        onCancel: id => autosave.noteReject(id),
      })
    } else if (latest.reason && /^(sign\.|road\.|face\.|tool\.|edit\.)/.test(latest.type)) {
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
        if (picked.type === 'glass' && optionId === 'curtain-wall') {
          useStore.setState({
            curtainWidth: Math.max(1, Math.min(4, picked.w)) as 1 | 2 | 3 | 4,
            curtainHeight: picked.cfg.curtainHeight ?? 4,
          })
        }
        if (picked.type === 'psd-end' && picked.cfg.variant !== 'cover' && picked.cfg.psd) {
          useStore.setState({ psdEndHeight: picked.cfg.psd })
        }
        if (picked.type === 'sign') {
          tools.adoptSignBoards(signBoardsOf(picked.cfg, tools.station))
        }
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

  // Synchronize the active UI theme (`blueprint` / `site` / `studio`) to Unity's main
  // viewport void colour and fog on mount and on every Settings theme switch (plan 37 §6.2).
  const sendUiTheme = (): void => {
    stationBridge.send('view.set', { key: 'theme', value: getUiTheme() })
  }
  const unsubscribeTheme = subscribeUiTheme(sendUiTheme)
  if (!isBenchmark || desktopOverlay) sendUiTheme()

  // Ask the host for its station once the player registers: a demo route names
  // the document to open, benchmark routes defer loading until the user starts
  // a run (avoiding a throwaway `new` station allocation on WebGL), a valid
  // WebGL autosave restores before `station.resync`, and any explicit open
  // cancels the deferred startup action.
  const demo = isBenchmark ? null : demoStationForPath(location.pathname)
  const startupAction = resolveWebGlStartupAction({
    isBenchmark,
    desktopOverlay,
    demoId: demo,
    storage: webglStorage,
  })
  queueMicrotask(() => {
    if (startupCancelled) return
    if (startupAction.kind === 'benchmark') {
      stationBridge.send('benchmark.mode', { active: true })
    } else if (startupAction.kind === 'openDemo') {
      stationBridge.send('station.openDemo', { id: startupAction.id }, {
        beforeSend: ({ id }) => autosave.trackCommand(id, 'replace'),
        onCancel: id => autosave.noteReject(id),
      })
    } else if (startupAction.kind === 'openAutosave') {
      stationBridge.send('station.open', { document: startupAction.document, sourceId: 'autosave' }, {
        beforeSend: ({ id }) => autosave.trackCommand(id, 'restore'),
        onCancel: id => autosave.noteReject(id),
      })
    } else {
      stationBridge.send('station.resync', undefined, {
        beforeSend: ({ id }) => autosave.trackCommand(id, 'resync'),
        onCancel: id => autosave.noteReject(id),
      })
    }
  })

  const root = createRoot(element)
  root.render(
    <UnityShellRoot
      canvas={canvas}
      host={host}
      adapter={cameraAdapter}
      desktop={desktopOverlay}
      initialBenchmark={isBenchmark}
      registerToggle={open => { openDesktopBenchmark = open }}
    />,
  )
  // The committed snapshot is the player's public state; a browser check reads it
  // instead of scraping the DOM, and can drive the station through the same port
  // the UI uses (`verify-station-game.mjs`).
  ;(window as unknown as { __metroStationBridge?: typeof stationBridge }).__metroStationBridge = stationBridge
  // The sign editor's ✓ commits through the host while this shell owns the station;
  // the app registers no such port on its own (plan 11 F3 / `app/stationHostBridge.ts`).
  // The same port carries the document verbs whose only writer is the host (plan 27 §4), so
  // Ctrl+Z/Y, Delete and Escape reach the one edit history instead of a shadow store copy.
  const sendRevisionedEdit = (type: string, payload: Record<string, unknown>): boolean => {
    const rev = stationBridge.getSnapshot().revision
    stationBridge.send(type, payload, rev >= 0 ? { expectedRevision: rev } : {})
    return true
  }
  const carriedMoveAdapter = createCarriedMoveAdapter({
    getSnapshot: () => stationBridge.getSnapshot(),
    subscribe: listener => stationBridge.subscribe(listener),
    ownsStation: () => unityHostOwnsStation(),
    getLanguage: () => getLanguage(),
  })
  registerStationHostCommit({
    ownsStation: () => unityHostOwnsStation(),
    commitSignBoards: (moduleId, boards) => commitSignBoardsToHost(moduleId, boards),
    commitExit: (moduleId, patch) => sendRevisionedEdit('edit.exit', { moduleId, ...patch }),
    commitCityStyle: city => sendRevisionedEdit('edit.city', { city }),
    commitStationName: (name, nameEn) => sendRevisionedEdit('edit.rename', { name, nameEn }),
    commitAddLine: direction => {
      const snap = stationBridge.getSnapshot()
      let queuedAdd = false
      stationBridge.send(
        'edit.line.add',
        direction ? { direction } : {},
        {
          ...(snap.revision >= 0 ? { expectedRevision: snap.revision } : {}),
          beforeSend: ({ id, queued }) => {
            queuedAdd = queued
            if (queued) lineSelection.reserveAdd(id)
          },
          beforeDispatch: ({ id, sessionId, stationEpoch }) => {
            if (queuedAdd) lineSelection.bindAdd(id, sessionId, stationEpoch)
            else lineSelection.trackAdd(id, sessionId, stationEpoch)
          },
          onCancel: id => {
            lineSelection.noteReject(id)
          },
        },
      )
      return true
    },
    commitRemoveLine: lineId => sendRevisionedEdit('edit.line.remove', { lineId }),
    commitUpdateLine: (lineId, patch) => sendRevisionedEdit('edit.line.update', { lineId, patch }),
    commitLiftDoorSide: (moduleId, z, side) => sendRevisionedEdit('edit.lift.doors', { moduleId, z, side }),
    commitSwitchRunDirection: moduleId => sendRevisionedEdit('edit.run.reverse', { moduleId }),
    commitSwitchRoadDirection: moduleId => sendRevisionedEdit('edit.road.reverse', { moduleId }),
    commitRegenRail: trackId => sendRevisionedEdit('edit.rail.regen', { trackId }),
    startMove: moduleId => {
      stationBridge.send('edit.move.start', { moduleId })
      return true
    },
    undo: () => { sendHistoryStep('edit.undo'); return true },
    redo: () => { sendHistoryStep('edit.redo'); return true },
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
    getCarriedMove: () => carriedMoveAdapter.getCarriedMove(),
    subscribeCarriedMove: listener => carriedMoveAdapter.subscribeCarriedMove(listener),
  })
  const unmount = (): void => {
    if (activeShell !== null && activeShell.unmount === unmount) activeShell = null
    startupCancelled = true
    if (activeAutosave === autosave) activeAutosave = null
    autosave.dispose()
    if (activeLineSelection === lineSelection) activeLineSelection = null
    lineSelection.clear()
    unsubscribeTheme()
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
    trainMarks.dispose()
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
