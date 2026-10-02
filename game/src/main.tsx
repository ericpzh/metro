import { createRoot } from 'react-dom/client'
import { MobileNotice } from './app/MobileNotice.tsx'
import { isMobileMode } from './app/mobile.ts'
import './styles.css'

const root = createRoot(document.getElementById('root') as HTMLElement)

if (isMobileMode()) {
  // A phone or tablet gets a plain page. Neither the game nor its three.js
  // bundle is imported, so nothing renders, simulates or downloads here.
  root.render(<MobileNotice />)
} else {
  void import('./app/boot.tsx').then(({ renderGame }) => renderGame(root))
}
