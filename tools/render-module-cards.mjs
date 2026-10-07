// Renders module 04's cards with the game's own renderer and writes a catalogue
// index beside them.
//
//   node tools/render-module-cards.mjs [--w 196] [--h 160] [--out .preview/module-cards]
//
// The catalogue sheet must draw each piece the way the game draws it, because it
// draws **the same piece**: this boots the built game at `?capture-cards`, calls
// the pass the build rail itself uses (`app/moduleThumbnails.ts`), and writes one
// PNG per family plus an `index.json` of the card's own text.
//
//   game/src/render/models.ts          builds the piece
//   game/src/app/captureCards.ts       frames, lights and renders it, names the frames
//   this file                          writes the pixels and the index to disk
//
// Nothing about a piece — its geometry, its camera, its lights, its label, its
// footprint or its throughput — is stated here or in the sheet. Requires
// `game/dist` (`npm run build:game`); Chrome launches because a piece's display,
// marquee, poster and inscription are canvases the game paints at render time.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const DIST = join(repo, 'game', 'dist')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const width = Number(arg('w', 196))
const height = Number(arg('h', 160))
const outDir = resolve(repo, arg('out', join('.preview', 'module-cards')))
const PORT = Number(arg('port', 4194))
const DEBUG_PORT = Number(arg('debug-port', 9336))

const server = await serveDir(DIST, PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/?capture-cards`,
  profile: join(repo, '.preview', `.chrome-module-cards-${process.pid}`),
  debugPort: DEBUG_PORT,
  verbose: Boolean(process.env.CARDS_VERBOSE),
})

try {
  await waitFor(session.evaluate, '!!window.__moduleCards && !!window.__moduleCardsReady', {
    what: 'the card capture pass',
  })

  const cards = await session.evaluate(`(async () => {
    const { catalogueCards, captureModuleCards } = window.__moduleCards
    const wanted = catalogueCards(${width}, ${height})
    const shots = await captureModuleCards(wanted.frames)
    const pixels = new Map(shots.map((s) => [s.id, s.png]))
    return wanted.cards.map((c) => ({ ...c, png: pixels.get(c.id) ?? null }))
  })()`)

  if (!Array.isArray(cards) || !cards.length) throw new Error('the capture pass returned no cards')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const index = []
  for (const card of cards) {
    if (!card?.png) throw new Error(`no pixels came back for ${card?.id ?? 'a card'}`)
    const b64 = String(card.png).split(',')[1]
    const file = `${card.id}.png`
    writeFileSync(join(outDir, file), Buffer.from(b64, 'base64'))
    index.push({ ...card, png: undefined, file })
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ width, height, cards: index }, null, 1))
  console.log(`module cards: ${index.length} rendered at ${width}x${height} -> ${outDir}`)
  console.log(index.map((c) => c.id).join(', '))
} finally {
  await session.close()
  server.close()
}
