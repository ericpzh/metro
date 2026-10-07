// Renders sheet 03's block pictures with the game's own renderer and writes an
// index beside them.
//
//   node tools/render-block-cards.mjs [--scale 1] [--out .preview/block-cards]
//
// Sheet 03 is about the block, and the block is drawn by the game's own chunk
// mesher wearing the game's own finish materials — so what the sheet embeds is a
// photograph of the real thing, square rim, flush seams, granite speckle and all.
//
//   game/src/render/chunkMesher.ts   meshes the cells, from their neighbour exposure
//   game/src/render/materials.ts     paints each finish's texture
//   game/src/app/captureBlocks.ts    arranges the specimens, frames and renders them
//   this file                        writes the pixels and the index to disk
//
// The index carries the material table too, read from `sim/finishes.ts` by the
// capture, so nothing on the sheet restates a value the simulation owns. Requires
// `game/dist` (`npm run build:game`); Chrome launches because a finish is a canvas
// the game paints at render time.

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
const scale = Number(arg('scale', 1))
const outDir = resolve(repo, arg('out', join('.preview', 'block-cards')))
const PORT = Number(arg('port', 4195))
const DEBUG_PORT = Number(arg('debug-port', 9337))

const server = await serveDir(DIST, PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/?capture-blocks`,
  profile: join(repo, '.preview', `.chrome-block-cards-${process.pid}`),
  debugPort: DEBUG_PORT,
  verbose: Boolean(process.env.BLOCKS_VERBOSE),
})

try {
  await waitFor(session.evaluate, '!!window.__blockCards && !!window.__blockCardsReady', {
    what: 'the block capture pass',
  })

  const result = await session.evaluate(`(async () => {
    const { blockPieces, captureBlockCards, finishTable } = window.__blockCards
    const wanted = blockPieces('#0d141d', ${scale})
    const shots = await captureBlockCards(wanted.frames)
    const pixels = new Map(shots.map((s) => [s.id, s]))
    const frames = new Map(wanted.frames.map((f) => [f.id, f]))
    return {
      pieces: wanted.pieces.map((p) => {
        const shot = pixels.get(p.id)
        const frame = frames.get(p.id)
        return {
          ...p,
          width: frame.width,
          height: frame.height,
          anchors: shot ? shot.anchors : null,
          png: shot ? shot.png : null,
        }
      }),
      finishes: finishTable(),
    }
  })()`)

  const pieces = result?.pieces
  if (!Array.isArray(pieces) || !pieces.length) throw new Error('the capture pass returned no pictures')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const index = []
  for (const piece of pieces) {
    if (!piece?.png) throw new Error(`no pixels came back for ${piece?.id ?? 'a picture'}`)
    const b64 = String(piece.png).split(',')[1]
    const file = `${piece.id}.png`
    writeFileSync(join(outDir, file), Buffer.from(b64, 'base64'))
    index.push({
      id: piece.id,
      label: piece.label,
      note: piece.note,
      width: piece.width,
      height: piece.height,
      anchors: piece.anchors,
      file,
    })
  }
  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify({ scale, pieces: index, finishes: result.finishes }, null, 1),
  )
  console.log(`block pictures: ${index.length} rendered -> ${outDir}`)
  console.log(index.map((p) => p.id).join(', '))
  console.log(`finishes: ${result.finishes.length} (${result.finishes.map((f) => f.label).join(' · ')})`)
} finally {
  await session.close()
  server.close()
}
