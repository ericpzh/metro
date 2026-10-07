// The game's own 扶梯 and 楼梯, photographed from the **drawing kit's isometric corner**, for
// a sheet that draws a station as a volume.
//
//   node tools/render-piece-views.mjs [--out .preview/piece-views] [--scale 2]
//
// `render-piece-elevations.mjs` shoots a piece square-on, which is what a *section* needs and
// the wrong picture twice over for `art/13-two-line-interchange.svg`: that sheet is an
// isometric scene, and a flat cut-out dropped into a volume reads as a cut-out. So this asks
// the same pass (`app/moduleThumbnails.ts`) for the same pieces on the same two screen rows
// the drawing kit projects with — `px = (x - y) * TW`, `py = (x + y) * TH - z * ZU` — which
// is exactly how `tools/render-train-cards.mjs` photographs a consist for that sheet.
//
// The picture alone is not enough to place a piece in a drawing, so the pass also reports
// **how it is laid out**: the frame in the kit's own metres, the pixels it came back as (which
// over those metres is the scale), the piece's own bounds, and — the one that matters — where
// its **origin** landed in the picture. A 扶梯's origin is its lower landing and a 楼梯's is
// its lower landing cell, so a sheet that puts that point on the floor it starts from cannot
// float the run.
//
//   game/src/render/models/pieces/EscalatorModel.ts   the 扶梯
//   game/src/render/models/pieces/StairModel.ts       the 楼梯
//   game/src/app/moduleThumbnails.ts                  draws and measures them
//   this file                                         writes the pixels and the layout
//
// Requires `game/dist` (`npm run build:game`); Chrome launches because the model kit paints
// its surfaces at render time.

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

const OUT = resolve(repo, arg('out', join('.preview', 'piece-views')))
const SCALE = Number(arg('scale', 2))
const PORT = Number(arg('port', 4218))
const DEBUG_PORT = Number(arg('debug-port', 9352))

/**
 * The pieces the isometric sheets are drawn from, and the corner each is taken from.
 *
 * A **楼梯** is built with its local +x up the run, which is the kit's own +x, so it is
 * photographed straight: a scene's `from → to` then runs the same way the picture's right
 * does, and the sheet mirrors the picture for the runs that climb the other way.
 *
 * A **扶梯** is not. `EscalatorModel` builds it with local +x running `from → to`, i.e.
 * *downhill* — so on the kit's axes it comes out with its foot on the right, against the
 * stair's own convention. It is photographed `iso-flip`: the same corner, the same pixels, a
 * sheet that mirrors it gets its foot on the left like the stair. That is a change of the
 * *picture's* handedness, not of the model — the kit's projection is left-handed against a true
 * view from that corner, which is why a sheet mirrors a consist the same way, and why `from` is
 * a fact about the picture that a sheet has to act on rather than something this pass applies.
 *
 * The rest of the list is the equipment sheet 01 stands in its concourse — the same palette ids
 * `render-piece-elevations.mjs` shoots square-on for the section, and the same `iso-flip` set it
 * turns, since a display, a stocked shelf or a screen wall faces the traveller and this corner
 * looks at the other flank.
 */
const VIEWS = {
  escalator: { from: 'iso-flip' },
  'stair-straight': { from: 'iso' },
  // Sheet 01's nine zones: gates, TVMs, retail, the ad board, the entrance, the screen wall and
  // the lift, whose cabin and shaft are asked for apart so a sheet travels a real cabin in it.
  gate: { from: 'iso' },
  tvm: { from: 'iso-flip' },
  // Not `iso-flip` like its neighbours: turned, a 自动售货机 shows the plain back of its cabinet
  // and no display at all, which is what the first pass of this list came back with.
  vending: { from: 'iso' },
  shelf: { from: 'iso-flip' },
  'billboard-panorama': { from: 'iso' },
  'exit-covered-1': { from: 'iso' },
  'platform-edge': { from: 'iso-flip' },
  // `lift-car` is deliberately not asked for: the cabin is not separable in this pass — asked
  // for on its own it returns the shaft again, byte for byte, and a sheet that embedded both
  // would carry the same picture twice. A sheet stands the shaft and the cabin travels inside it.
  'lift-shaft': { from: 'iso' },
}

/** A PNG's pixel size, straight out of its IHDR. */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const server = await serveDir(DIST, PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/?capture-pieces`,
  profile: join(repo, '.preview', `.chrome-piece-views-${process.pid}`),
  debugPort: DEBUG_PORT,
  windowSize: '1400,900',
  verbose: Boolean(process.env.PIECE_VERBOSE),
})

try {
  await waitFor(session.evaluate, 'Boolean(window.__pieceElevationsReady)', { what: 'the piece pass' })
  const result = await session.evaluate(`(async () => {
    const { renderModulePieces } = window.__pieceElevations
    return await renderModulePieces(1024, {
      ids: [],
      pxPerMetre: 100,
      scale: ${SCALE},
      views: ${JSON.stringify(VIEWS)},
    })
  })()`)

  const images = result?.images
  const layout = result?.layout
  if (!images || !layout) throw new Error('the pass returned nothing')

  const index = []
  for (const [id, view] of Object.entries(VIEWS)) {
    // The pass hands pictures back **per piece**. It used to hand them back per corner, which
    // silently gave every piece after the first one on a corner the last render's pixels.
    const png = images[id]
    const at = layout[id]
    if (!png || !at) throw new Error(`the pass drew no \`${id}\``)
    const buffer = Buffer.from(png.split(',')[1], 'base64')
    const file = `${id}.png`
    writeFileSync(join(OUT, file), buffer)
    index.push({
      id,
      file,
      from: at.from,
      // The frame in the projection's own pixels: across the picture is the kit's `right` row,
      // up it is the kit's up row, and the sheet's `runImage` is what takes them into a scene.
      metres: at.metres,
      verticalMetres: at.verticalMetres,
      origin: at.origin,
      // What was actually drawn, and where in the picture. The frame is drawn to a rectangle
      // and a piece is not one, so a sheet sizes a run by this rather than by the frame.
      content: at.content,
      box: at.box,
      // The picture's real pixels, which over `metres` is the scale it was drawn at — so a
      // sheet measures the drawing rather than assuming the `--scale` it asked for.
      px: pngSize(buffer),
      /** What the frame costs in the scene: the pad around the piece, as an asked-for scale. */
      askedScale: SCALE,
    })
    console.log(
      `  ${id.padEnd(16)} ${index[index.length - 1].px.width}x${index[index.length - 1].px.height} px` +
        `  frame ${at.metres.toFixed(2)} x ${at.verticalMetres.toFixed(2)} (kit px)` +
        `  origin ${at.origin.map((v) => v.toFixed(3)).join(',')}` +
        `  rise ${(at.box.z[1] - at.box.z[0]).toFixed(2)} m`,
    )
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ scale: SCALE, pieces: index }, null, 1))
  console.log(`piece views: ${index.length} rendered -> ${OUT}`)
} finally {
  await session.close()
  server.close()
}
