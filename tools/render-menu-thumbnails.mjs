// Generate the PNGs used by the left build menu with the game's real module renderer.
//
//   npm --prefix game run build
//   node tools/render-menu-thumbnails.mjs
//   npm --prefix game run build
//
// The first build supplies game/dist to the capture browser; the last copies the
// generated files in game/public/module-thumbnails into the production app.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repo, 'game', 'public', 'module-thumbnails')
const server = await serveDir(join(repo, 'game', 'dist'), 4195)
const page = await withPage({
  url: `http://127.0.0.1:${server.address().port}/?capture-menu-thumbnails`,
  profile: join(repo, '.preview', `.chrome-menu-thumbnails-${process.pid}`),
  debugPort: 9357,
})

try {
  await waitFor(page.evaluate, '!!window.__menuThumbnailsReady && !!window.__menuThumbnails', {
    what: 'the menu thumbnail renderer',
  })
  const thumbnails = await page.evaluate(`window.__menuThumbnails.renderModuleThumbnails(132, null, {
    hideSecondGateDoor: true,
    pixelRatio: 1,
  })`)
  const ids = Object.keys(thumbnails ?? {}).sort()
  if (ids.length < 100) throw new Error(`expected at least 100 menu thumbnails; renderer returned ${ids.length}`)

  mkdirSync(outDir, { recursive: true })
  const index = []
  let bytes = 0
  for (const id of ids) {
    const dataUrl = String(thumbnails[id])
    const base64 = dataUrl.startsWith('data:image/png;base64,') ? dataUrl.slice('data:image/png;base64,'.length) : ''
    if (!base64) throw new Error(`renderer returned invalid PNG data for ${id}`)
    const png = Buffer.from(base64, 'base64')
    const file = `${id}.png`
    writeFileSync(join(outDir, file), png)
    bytes += png.byteLength
    index.push({ id, file, bytes: png.byteLength })
  }
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify({ width: 132, height: 132, pixelRatio: 1, thumbnails: index }, null, 2)}\n`)
  console.log(`menu thumbnails: ${ids.length} PNGs, ${(bytes / 1024).toFixed(1)} KiB -> ${outDir}`)
} finally {
  await page.close()
  server.close()
}
