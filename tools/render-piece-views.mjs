// The game's own 扶梯 and 楼梯, photographed from the **drawing kit's isometric corner**, for
// a sheet that draws a station as a volume.
//
//   node tools/render-piece-views.mjs [--out .preview/piece-views] [--scale 2]
//   node tools/render-piece-views.mjs --hero --scale 4
//
// --hero captures sheet 01's individually turned equipment into a separate
// directory, so revising its layout/facing cannot replace sheet 13's runs.
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

const HERO = process.argv.includes('--hero')
const OUT = resolve(repo, arg('out', join('.preview', HERO ? 'hero-piece-views' : 'piece-views')))
// Four samples are plenty at sheet scale and keep a 40 m wall under 4096 px.
const SCALE = Number(arg('scale', HERO ? 4 : 2))
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
const VIEWS = HERO ? {
  // The camera sees +x/+y. Machines face local -y, so turn their actual models.
  escalator: { from: 'iso', rotationZ: 180, anchor: [0.5, 0.5, 1] },
  'stair-straight': { from: 'iso', rotationZ: 180, anchor: [0.5, 0.5, 1] },
  // Sheet 13: uphill along +x, parallel to the two underground roads.
  'escalator-x': { modelId: 'escalator', from: 'iso', rotationZ: -90, anchor: [0.5, 0.5, 1] },
  'stair-straight-x': { modelId: 'stair-straight', from: 'iso', rotationZ: -90, anchor: [0.5, 0.5, 1] },
  gate: { from: 'iso', padding: 1.12 },
  fence: { from: 'iso' },
  extinguisher: { from: 'iso', rotationZ: 180 },
  bin: { from: 'iso', rotationZ: 180 },
  'door-steel-2': { from: 'iso', rotationZ: 180 },
  tvm: { from: 'iso', rotationZ: 180 },
  vending: { from: 'iso', rotationZ: 180 },
  shelf: { from: 'iso', rotationZ: 180 },
  'bench-steel-1': { from: 'iso', rotationZ: 180 },
  'billboard-panorama': { from: 'iso' },
  'platform-edge': { from: 'iso' },
  'platform-edge-far': { modelId: 'platform-edge', from: 'iso', rotationZ: 180 },
  // Interchange: one 40 m screen wall per edge, and the street head house.
  'platform-edge-40': { modelId: 'platform-edge', from: 'iso', psdCells: 40 },
  'platform-edge-40-far': { modelId: 'platform-edge', from: 'iso', rotationZ: 180, psdCells: 40 },
  'exit-covered-1': { from: 'iso', rotationZ: 180 },
  'lift-shaft': { from: 'iso', rotationZ: 180 },
  'lift-car': { from: 'iso', rotationZ: 180 },
} : {
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
  // The shaft and the cabin it carries, asked for apart: sheet 01 stands the shaft and shows the
  // cabin in it, which is the difference between a lift and one more stainless column.
  'lift-shaft': { from: 'iso' },
  'lift-car': { from: 'iso' },
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
  /**
   * How long a run of 屏蔽门 the `platform-edge` picture is, in cells.
   *
   * The piece is built to the length the caller asks for (`psdCells`), which is what makes it
   * usable at all: a screen is not a thing that tiles, it is a *run* between two door openings, and
   * sheet 01's runs are 2.86 m — the gap the game's own door cadence leaves between two doors of a
   * B-type car (`(19.5 − 4 × 1.3) / 5`). Asked for at one cell it was a metre of screen that could
   * neither fill a run nor line up with a door; asked for at the run's own length it is the run.
   *
   * The hero uses a complete 28 m run, including the model's own openings and
   * end panels, on each edge. The other sheets retain their 2.86 m bay capture.
   */
  const PSD_CELLS = HERO ? 28 : 2.86
  const result = await session.evaluate(`(async () => {
    const { renderModulePieces } = window.__pieceElevations
    return await renderModulePieces(1024, {
      ids: [],
      pxPerMetre: 100,
      scale: ${SCALE},
      psdCells: ${PSD_CELLS},
      stationName: ${JSON.stringify(HERO ? '动物园站' : null)},
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
      anchor: at.anchor,
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
