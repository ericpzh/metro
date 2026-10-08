import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import GamePage from './components/GamePage.jsx'
import { isGamePath } from './i18n.js'
import './styles.css'

// The 游戏 tab is the same document served from `<site>/game/` (or
// `<site>/en/game/` for English) — the Worker aliases that subpath to the
// site root, so relative `./assets/...` resolve.
const isGame = isGamePath(window.location.pathname)

createRoot(document.getElementById('root')).render(
  <StrictMode>{isGame ? <GamePage /> : <App />}</StrictMode>,
)
