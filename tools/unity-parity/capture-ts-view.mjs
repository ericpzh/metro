// Photograph the TypeScript station at its home view, so the Unity player can be
// compared against the same camera (plan 13 §2/§7: "match at source-equivalent views").
//
// The TS app is the behavioural oracle for the Unity port. The D4 comparison already
// established that both engines frame the same station identically at home (bbox IoU
// 0.927); this script regenerates the TS half of that comparison on demand instead of
// depending on a hand-run capture that no longer exists in the tree.
//
//   # terminal 1
//   npm --prefix game run dev            # vite on http://127.0.0.1:5173
//   # terminal 2
//   node tools/unity-parity/capture-ts-view.mjs --out .preview/unity/parity-13-ts/ts-home.png
//
// It opens the plain game route, loads the Zoo example station through the same
// `loadReference` action the Open button uses, fires the `metro:home` event (the handler
// Ctrl+H runs), and crops the canvas out of the page so the PNG is comparable 1:1 with a
// Unity canvas capture.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { withPage, loadExampleStation, waitFor } from '../browser-harness.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const url = option('url', 'http://127.0.0.1:5173/game')
const out = resolve(option('out', '.preview/unity/parity-13-ts/ts-home.png'))
const station = option('station', 'zoo')
const view = option('view', 'home')

const page = await withPage({ url, profile: resolve(`.preview/unity/parity-13-ts/chrome-${process.pid}`), windowSize: '1280,720' })
try {
  await loadExampleStation(page, station)
  await waitFor(page.evaluate, '!!window.__scene && window.__scene.framesRendered > 2', { what: 'the renderer' })
  if (view === 'home') {
    // The same code path Ctrl+H takes (`Viewport.tsx` listens for `metro:home`).
    await page.evaluate(`new Promise(resolve => {
      window.dispatchEvent(new Event('metro:home'))
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })`)
  }
  const state = await page.evaluate(`(() => {
    const scene = window.__scene
    const canvas = document.querySelector('canvas.viewport') ?? document.querySelector('canvas')
    const rect = canvas.getBoundingClientRect()
    return {
      station: window.__metro.getState().stationId ?? null,
      camera: scene.camera.position.toArray(),
      target: scene.controls?.target?.toArray?.() ?? null,
      zoom: scene.camera.zoom,
      orthographic: scene.camera.isOrthographicCamera === true,
      level: window.__metro.getState().activeZ,
      theme: document.documentElement.dataset.theme ?? null,
      canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      devicePixelRatio: window.devicePixelRatio,
    }
  })()`)
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: state.canvas.x, y: state.canvas.y, width: state.canvas.width, height: state.canvas.height, scale: 1 },
  })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(JSON.stringify({ out, ...state }, null, 2))
} finally {
  await page.close()
}
