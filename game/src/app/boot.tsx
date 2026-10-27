// Game bootstrap. Kept in its own module so the mobile gate in main.tsx can
// render the notice without downloading the scene: this file is imported only
// when the page is not in mobile mode.

import type { Root } from 'react-dom/client'
import { App } from './App.tsx'
import { Lab } from './Lab.tsx'
import { initSim, useStore } from './store.ts'
import { toData } from '../build/model.ts'
import { AUTOSAVE_INTERVAL_MS, readAutosave, watchAutosave } from './autosave.ts'
import { demoStationForPath, gamePathFor } from './demoRoute.ts'
import { startGlobalStats } from './globalStats.ts'
import { BenchmarkRoute } from './benchmark/BenchmarkRoute.tsx'
import { initUiTheme } from './uiTheme.ts'

const path = location.pathname.replace(/\/+$/, '')
const isLab = path.endsWith('/lab')
const isBenchmark = path.endsWith('/benchmark') || path.endsWith('/benchmark/en')

/**
 * The store on `window`, for driving the game from a console or a browser-driven
 * check (a headless run can set the tool, open a panel and read the document
 * back, which is how a layout or a hover bug gets reproduced without a human).
 * It is the live Zustand store, not a copy, so `getState()` reflects the game.
 */
declare global {
  interface Window {
    __metro?: typeof useStore
    /**
     * The live renderer, hung on `window` by `Viewport` for the same reason the
     * store is: a browser-driven check can aim its camera at a corner and
     * photograph what the game actually draws.
     */
    __scene?: import('../render/scene.ts').SceneRenderer
    __benchmarkScene?: import('../render/scene.ts').SceneRenderer
  }
}

export function renderGame(root: Root): void {
  if (!isLab && !isBenchmark) initUiTheme()
  // A demo link names its document (/game/zoo, /game/en/tanwei): it opens that
  // station whether or not this browser holds an autosave. The link is a start,
  // not a location — the URL becomes the plain game path, so a reload restores
  // what the player was building rather than throwing their edits away.
  const demo = isLab || isBenchmark ? null : demoStationForPath(location.pathname)
  if (demo) {
    useStore.getState().loadReference(demo)
    const url = new URL(location.href)
    url.pathname = gamePathFor(url.pathname)
    window.history.replaceState(null, '', url)
  }

  if (!isLab && !isBenchmark) {
    try {
      const storage = window.localStorage
      if (!demo) {
        const restored = readAutosave(storage)
        if (restored) {
          let activeZ = restored.levelBase
          for (const c of restored.cells) if (c.z < activeZ) activeZ = c.z
          for (const m of restored.modules) if (m.z < activeZ) activeZ = m.z
          useStore.setState({ station: restored, activeZ })
        }
      }
      const autosave = watchAutosave(useStore, storage)
      window.setInterval(autosave.flush, AUTOSAVE_INTERVAL_MS)
      window.addEventListener('pagehide', autosave.flush)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') autosave.flush()
      })
    } catch { /* Storage access may be disabled; the game still opens normally. */ }
  }
  root.render(isLab ? <Lab /> : isBenchmark ? <BenchmarkRoute /> : <App />)
  window.__metro = useStore

  // A demo link loaded its station (and its worker) above; a second `init` would
  // only build the same graph twice.
  if (!isLab && !demo) {
    const station = toData(useStore.getState().station)
    initSim(station, station.seed)
  }

  // Anonymous totals: one five-minute collector and a pagehide beacon. It
  // resolves the stats Worker for this host, so the lab, benchmark, a local
  // production preview and a preview deployment without a stats API stay silent.
  if (!isLab && !isBenchmark) startGlobalStats()
}
