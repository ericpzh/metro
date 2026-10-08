// Side elevations of the game's own pieces, for a section drawing.
//
//   node tools/render-piece-elevations.mjs [--out .preview/piece-elevations] [--scale 2] [--port 4216]
//
// Sheet 02 cuts a station in half. Its building is drawn — the game has no station shaped
// like that one to photograph — but the things standing in it are real, and this is where
// they come from: the rail's own piece builder (`app/moduleThumbnails.ts`), asked for a
// square-on view instead of an icon.
//
// Every piece is framed at **one scale** with its base on the picture's bottom edge, so a
// reader can compare a 闸机 with a 商铺 and a sheet has only to put that edge on a floor
// line. The scale is not written into the index because it does not have to be: the PNG's
// own pixel size, divided by `pxPerMetre * scale`, *is* the piece's size in metres.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const DIST = resolve(repo, 'game', 'dist')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const OUT = resolve(repo, arg('out', join('.preview', 'piece-elevations')))
const SCALE = Number(arg('scale', 2))
const PORT = Number(arg('port', 4216))
const DEBUG_PORT = Number(arg('debug-port', 9349))

/**
 * The pieces a vertical section stands in its rooms, at the sheet's own 26 px per metre.
 * The ids are palette ids, so a piece is the one the rail places, sub-menu choice and all.
 */
const PX_PER_M = 26
/**
 * The pieces whose readable face points away from the camera.
 *
 * The 自动售货机 and 自动售票机 face +y and were fine as they stood — turning them is what
 * left a blank cabinet on the sheet. The **货架** is the other way round: its stocked face
 * is the one a shopper walks up to, so it is the piece that has to be turned.
 */
const FLIP = ['vending', 'tvm', 'shelf', 'platform-edge', 'extinguisher', 'bin', 'door-steel-2', 'bench-steel-1', 'lift-car']
/** The B2 platform's run, in metres = cells. */
const PSD_CELLS = 21
/** The section's core serves three storeys, so its 电梯 is one lift stacked three deep. */
const LIFT_STOREYS = 3
/** The palette entries to ask for. `lift-car` is not in the catalogue: it is the cabin the
 *  lift model already draws, asked for on its own. */
const PIECES = [
  'gate',
  'tvm',
  'vending',
  // The biggest format the catalogue has: a 横版 in one cell reads as a poster,
  // not as the ad board the section drew.
  'billboard-panorama',
  'escalator',
  // A 商铺 is a walled **area**, not a piece: its fit-out (shelves, desks, sinks) is
  // placed as modules of its own, so a shop on the sheet is a room with these in it.
  'shelf',
  'stair-straight',
  // The shaft and its cabin apart, so the sheet travels a real cabin inside a real
  // shaft rather than baking one into the other.
  'lift-shaft',
  'lift-car',
  'exit-covered-1',
  // The screen across the 2 号线 platform, one run long enough for a whole platform.
  'platform-edge',
  'fence',
  'extinguisher',
  'bin',
  'door-steel-2',
  'bench-steel-1',
]

/** A PNG's pixel size, straight out of its IHDR. */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const server = await serveDir(DIST, PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/?capture-pieces`,
  profile: join(repo, '.preview', `.chrome-piece-elevations-${process.pid}`),
  debugPort: DEBUG_PORT,
  windowSize: '1400,900',
  verbose: Boolean(process.env.PIECE_VERBOSE),
})

try {
  await waitFor(session.evaluate, 'Boolean(window.__pieceElevationsReady)', { what: 'the piece pass' })
  const result = await session.evaluate(`(async () => {
    const { renderModuleThumbnails } = window.__pieceElevations
    const pngs = await renderModuleThumbnails(132, {
      ids: ${JSON.stringify(PIECES)},
      pxPerMetre: ${PX_PER_M},
      scale: ${SCALE},
      liftStoreys: ${LIFT_STOREYS},
      flip: ${JSON.stringify(FLIP)},
      psdCells: ${PSD_CELLS},
      stationName: '动物园站',
    })
    return pngs
  })()`)

  const index = []
  for (const id of PIECES) {
    const png = result[id]
    if (!png) throw new Error(`the pass returned nothing for \`${id}\``)
    const buffer = Buffer.from(png.split(',')[1], 'base64')
    const file = `${id}.png`
    writeFileSync(join(OUT, file), buffer)
    const px = pngSize(buffer)
    index.push({
      id,
      file,
      px,
      // What the picture measures in metres — the frame's own pixels over the scale.
      metres: Math.round((px.width / (PX_PER_M * SCALE)) * 100) / 100,
      verticalMetres: Math.round((px.height / (PX_PER_M * SCALE)) * 100) / 100,
    })
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ pxPerMetre: PX_PER_M, scale: SCALE, pieces: index }, null, 1))
  console.log(`piece elevations: ${index.length} rendered at ${PX_PER_M} px/m -> ${OUT}`)
  for (const p of index) {
    console.log(`  ${p.id.padEnd(18)} ${p.px.width}x${p.px.height} px  =  ${p.metres} x ${p.verticalMetres} m`)
  }
} finally {
  await session.close()
  server.close()
}
