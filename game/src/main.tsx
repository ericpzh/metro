import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { Lab } from './app/Lab.tsx'
import { initSim } from './app/store.ts'
import { referenceStation } from './data/reference-station.ts'
import './styles.css'

const path = location.pathname.replace(/\/+$/, '')
const isLab = path.endsWith('/lab')

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(isLab ? <Lab /> : <App />)

if (!isLab) {
  // The demo opens on the reference station cold, with 0 passengers —
  // the crowd builds from the first train arrivals.
  initSim(referenceStation(), 1234567, { startSeconds: 7.45 * 3600, warmup: 0 })
}
