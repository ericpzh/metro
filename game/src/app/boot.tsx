// Game bootstrap. Kept in its own module so the mobile gate in main.tsx can
// render the notice without downloading the scene: this file is imported only
// when the page is not in mobile mode.

import type { Root } from 'react-dom/client'
import { App } from './App.tsx'
import { Lab } from './Lab.tsx'
import { initSim, useStore } from './store.ts'
import { referenceStation, REFERENCE_BOOT } from '../data/reference-station.ts'

const path = location.pathname.replace(/\/+$/, '')
const isLab = path.endsWith('/lab')

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
  }
}

export function renderGame(root: Root): void {
  root.render(isLab ? <Lab /> : <App />)
  window.__metro = useStore

  if (!isLab) {
    // The demo opens on the 动物园 station cold, with 0 passengers — the crowd
    // builds from the first train arrivals. The seed is the station's own, so a
    // cold boot and 打开 of the same document run the same crowd.
    const station = referenceStation()
    initSim(station, station.seed, REFERENCE_BOOT)
  }
}
