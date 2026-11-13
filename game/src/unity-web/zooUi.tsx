import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../app/windows/AppShell.tsx'
import { ViewCube } from '../app/ViewCube.tsx'
import { useStore } from '../app/store.ts'
import { initLanguage } from '../app/i18n.ts'
import { showGameLoading } from '../app/gameLoading.ts'
import { initUiTheme } from '../app/uiTheme.ts'
import { toState } from '../build/model.ts'
import { referenceStation } from '../data/reference-station.ts'
import { parse } from '../persistence/save.ts'
import type { SceneRenderer } from '../render/scene.ts'
import { zooBridge } from './bridge.ts'
import type { ZooSnapshot, ZooTool } from './bridge.ts'
import '../styles.css'
import './unity-ui.css'

const levels = new Set([0, -5, -10, -15, -20])
function selectedTool(): ZooTool {
  const state = useStore.getState()
  if (state.tool === 'block' && !state.halfWall && !state.triangles && !state.suspendedCeiling) return 'Floor'
  if (state.tool === 'module' && state.moduleType === 'gate') return 'Gate'
  if (state.tool === 'delete') return 'Delete'
  return 'Inspect'
}

function UnityViewport({ canvas }: { canvas: HTMLCanvasElement }): React.ReactElement {
  const container = useRef<HTMLDivElement>(null)
  const scene = useRef<SceneRenderer | null>(null)
  useEffect(() => {
    const stage = container.current
    if (!stage) return
    canvas.className = 'viewport'
    stage.appendChild(canvas)
    const reset = (event: MouseEvent): void => {
      if ((event.target as Element).closest('.viewHomeBtn')) zooBridge.send({ type: 'resetView' })
    }
    stage.addEventListener('click', reset)
    const home = (): void => zooBridge.send({ type: 'resetView' })
    window.addEventListener('metro:home', home)
    return () => { stage.removeEventListener('click', reset); window.removeEventListener('metro:home', home) }
  }, [canvas])
  return <div className="unityViewport" ref={container}><ViewCube sceneRef={scene} /></div>
}

function UnityApp({ canvas }: { canvas: HTMLCanvasElement }): React.ReactElement {
  const { snapshot } = useSyncExternalStore(zooBridge.subscribe, zooBridge.getSnapshot)
  return <App viewport={<UnityViewport canvas={canvas} />} zooStatus={snapshot ?? undefined} files={{ save: () => zooBridge.send({ type: 'save' }), open: value => zooBridge.send({ type: 'open', value }) }} />
}

export function mountUnityUI(element: HTMLElement, canvas: HTMLCanvasElement): () => void {
  initLanguage()
  initUiTheme()
  const station = toState(referenceStation('zoo'))
  const old = useStore.getState()
  useStore.setState({ station, activeZ: 0, playing: false,
    saveToFile: () => zooBridge.send({ type: 'save' }),
    setPlaying: on => { if (on !== useStore.getState().playing) zooBridge.send({ type: 'run' }) },
    setSpeed: speed => zooBridge.send({ type: 'speed', value: speed }),
  })
  let applyingSnapshot = false
  let previousTool = selectedTool()
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (applyingSnapshot) return
    if (state.activeZ !== previous.activeZ && levels.has(state.activeZ)) zooBridge.send({ type: 'level', value: state.activeZ })
    const tool = selectedTool()
    if (tool !== previousTool) { previousTool = tool; zooBridge.send({ type: 'tool', value: tool }) }
  })
  let lastMessage = ''
  let lastRevision = -1
  let dismissedLoading = false
  const dismissLoadingOnce = (): void => {
    if (dismissedLoading) return
    dismissedLoading = true
    const hide = (): void => {
      const screen = document.getElementById('game-loading')
      if (screen?.dataset.failed === 'true') return
      showGameLoading(false)
    }
    requestAnimationFrame(hide)
    window.setTimeout(hide, 60)
  }
  const receive = (snapshot: ZooSnapshot): void => {
    zooBridge.receive(snapshot)
    applyingSnapshot = true
    const parsed = snapshot.document && snapshot.revision !== lastRevision ? parse(snapshot.document) : null
    const changedStation = parsed?.ok ? { station: parsed.state } : {}
    useStore.setState({ ...changedStation, activeZ: snapshot.level, playing: snapshot.running, speed: snapshot.speed,
      ...(snapshot.message !== lastMessage ? { notice: snapshot.message } : {}) })
    if (parsed?.ok) lastRevision = snapshot.revision
    if (snapshot.document && snapshot.revision === lastRevision) {
      queueMicrotask(() => zooBridge.send({ type: 'documentReceived', value: snapshot.revision }))
    }
    lastMessage = snapshot.message
    applyingSnapshot = false
    dismissLoadingOnce()
  }
  const state = (event: Event): void => receive((event as CustomEvent<ZooSnapshot>).detail)
  window.addEventListener('metro:zoo-state', state)
  const existing = (window as Window & { zooPlayableState?: ZooSnapshot }).zooPlayableState
  if (existing) receive(existing)
  const root = createRoot(element)
  root.render(<UnityApp canvas={canvas} />)
  return () => {
    window.removeEventListener('metro:zoo-state', state)
    unsubscribe(); root.unmount(); zooBridge.unregister()
    useStore.setState({ saveToFile: old.saveToFile, setPlaying: old.setPlaying, setSpeed: old.setSpeed })
  }
}
export { zooBridge }
