import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import GamePage from './components/GamePage.jsx'
import './styles.css'

// The 游戏 tab is the same document served from `<site>/game/` (the Worker
// aliases that subpath to the site root, so relative `./assets/...` resolve).
const isGame = /\/game\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')).render(
  <StrictMode>{isGame ? <GamePage /> : <App />}</StrictMode>,
)
