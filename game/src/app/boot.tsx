// Game bootstrap. Kept in its own module so the mobile gate in main.tsx can
// render the notice without downloading the scene: this file is imported only
// when the page is not in mobile mode.

import type { Root } from 'react-dom/client'
import { App } from './App.tsx'
import { Lab } from './Lab.tsx'
import { initSim } from './store.ts'
import { referenceStation, REFERENCE_BOOT } from '../data/reference-station.ts'

const path = location.pathname.replace(/\/+$/, '')
const isLab = path.endsWith('/lab')

export function renderGame(root: Root): void {
  root.render(isLab ? <Lab /> : <App />)

  if (!isLab) {
    // The demo opens on the 动物园 station cold, with 0 passengers — the crowd
    // builds from the first train arrivals. The seed is the station's own, so a
    // cold boot and 打开 of the same document run the same crowd.
    const station = referenceStation()
    initSim(station, station.seed, REFERENCE_BOOT)
  }
}
