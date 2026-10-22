// Render the build rail's actual module thumbnails and save the pixels for visual review.
//
//   npm --prefix game run build
//   node tools/game-tiles.mjs
//
// The same renderer generates the versioned runtime assets through
// `tools/render-menu-thumbnails.mjs`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repo, '.preview', 'game-tiles')
const server = await serveDir(join(repo, 'game', 'dist'), 4193)
const page = await withPage({
  url: `http://127.0.0.1:${server.address().port}/?capture-menu-thumbnails`,
  profile: join(repo, '.preview', `.chrome-game-tiles-${process.pid}`),
  debugPort: 9335,
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
  if (ids.length < 100) throw new Error(`expected at least 100 module thumbnails; renderer returned ${ids.length}`)
  mkdirSync(outDir, { recursive: true })
  for (const id of ids) {
    const dataUrl = String(thumbnails[id])
    const base64 = dataUrl.startsWith('data:image/png;base64,') ? dataUrl.slice('data:image/png;base64,'.length) : ''
    if (!base64) throw new Error(`renderer returned invalid PNG data for ${id}`)
    writeFileSync(join(outDir, `${id}.png`), Buffer.from(base64, 'base64'))
  }
  console.log(`game tiles: ${ids.length} rendered into ${outDir}`)
} finally {
  await page.close()
  server.close()
}
