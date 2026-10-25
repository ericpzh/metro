import { createRoot } from 'react-dom/client'
import { MobileNotice } from './app/MobileNotice.tsx'
import { isMobileMode } from './app/mobile.ts'
import './styles.css'
import { initLanguage } from './app/i18n.ts'

initLanguage()

const root = createRoot(document.getElementById('root') as HTMLElement)

/**
 * Capture query routes serve the art pipeline, not the playable app.
 *
 * The art sheets and the build-rail PNGs use the game's **own** renderer, and that
 * pass only ends in pixels inside a browser. Capture routes boot the renderer and
 * nothing else: no station scene or simulation. Without a capture flag, the page
 * follows the normal game boot below.
 */
async function boot() {
  const params = new URLSearchParams(location.search)
  if (params.has('capture-road-vehicles')) {
    const capture = await import('./app/captureRoadVehicles.ts')
    Object.assign(window, { __roadVehicles: capture, __roadVehiclesReady: true })
    return
  }
  if (params.has('capture-passengers')) {
    const capture = await import('./app/capturePassengers.ts')
    Object.assign(window, { __passengerCards: capture, __passengerCardsReady: true })
    return
  }
  if (params.has('capture-cards')) {
    const capture = await import('./app/captureCards.ts')
    Object.assign(window, { __moduleCards: capture })
    // A flag the driver waits on: the import is asynchronous, and a tool that
    // guessed at a delay would be racing the first parse of the three.js bundle.
    ;(window as unknown as { __moduleCardsReady?: boolean }).__moduleCardsReady = true
    return
  }
  if (params.has('capture-menu-thumbnails')) {
    const capture = await import('./app/moduleThumbnails.ts')
    Object.assign(window, { __menuThumbnails: capture })
    ;(window as unknown as { __menuThumbnailsReady?: boolean }).__menuThumbnailsReady = true
    return
  }
  if (params.has('capture-blocks')) {
    // Sheet 03's own pass: the game's chunk mesher and finish materials, on real
    // cells — a block, a run of them, the three cut shapes, a small room.
    const capture = await import('./app/captureBlocks.ts')
    Object.assign(window, { __blockCards: capture })
    ;(window as unknown as { __blockCardsReady?: boolean }).__blockCardsReady = true
    return
  }
  if (params.has('capture-trains')) {
    // Sheet 11's own pass: `buildTrain` and the model kit, on a real consist per
    // class. Not a module, so it is not the rail's pass — but the same builder the
    // platform runs a train down.
    const capture = await import('./app/captureTrains.ts')
    Object.assign(window, { __trainCards: capture })
    ;(window as unknown as { __trainCardsReady?: boolean }).__trainCardsReady = true
    return
  }
  if (params.has('capture-pieces')) {
    // Sheet 02's own pass: the rail's own piece builder, asked for square-on side
    // elevations instead of icons, so a vertical section can carry the real 闸机, 扶梯,
    // 电梯 and 出入口 rather than boxes drawn to look like them. The same pass answers
    // `views` — the same pieces on the **drawing kit's isometric axes**, which is what
    // sheet 13's volume needs (`tools/render-piece-views.mjs`).
    const capture = await import('./app/moduleThumbnails.ts')
    Object.assign(window, { __pieceElevations: capture })
    ;(window as unknown as { __pieceElevationsReady?: boolean }).__pieceElevationsReady = true
    return
  }
  if (isMobileMode()) {
    // A phone or tablet gets a plain page. Neither the game nor its three.js
    // bundle is imported, so nothing renders, simulates or downloads here.
    root.render(<MobileNotice onProceed={() => {
      void import('./app/boot.tsx').then(({ renderGame }) => renderGame(root))
    }} />)
    return
  }
  const { renderGame } = await import('./app/boot.tsx')
  renderGame(root)
  if (params.has('bench-editor-actions')) {
    Object.assign(window, { __editorActions: await import('./app/benchmark/editorActions.ts') })
  }
}

void boot()
