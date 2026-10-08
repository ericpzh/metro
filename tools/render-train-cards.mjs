// Renders sheet 11's rolling-stock pictures with the game's own model builder, and
// crops the wide ones to what they actually contain.
//
//   node tools/render-train-cards.mjs [--out .preview/train-cards] [--trim-only]
//
// Sheet 05 gives the rolling stock's numbers; sheet 11 is the shape, and the shape is
// `buildTrain` — the consist the game itself runs down a platform, wearing the model
// kit's own materials.
//
//   game/src/render/models/pieces/TrainModel.ts   builds the consist
//   game/src/sim/stock.ts                         the classes, dimensions and door cadence
//   game/src/app/captureTrains.ts                 frames, lights and renders them
//   this file                                     writes the pixels, the table and the crop
//
// The index carries the stock table and the cabin's numbers too, read from `sim/` by
// the capture, so nothing on the sheet restates a dimension the simulation owns.
//
// `--trim-only` re-crops pictures that are already on disk without booting the game,
// which is what to run after a change to `TRIM` alone.
//
// Requires `game/dist` (`npm run build:game`) for a render; Chrome launches because
// the model kit paints its surfaces at render time.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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
const outDir = resolve(repo, arg('out', join('.preview', 'train-cards')))
const TRIM_ONLY = process.argv.includes('--trim-only')
const PORT = Number(arg('port', 4198))
const DEBUG_PORT = Number(arg('debug-port', 9340))

/**
 * The frames whose picture is **cropped to what it contains**.
 *
 * A whole consist is 30 : 1, and an oblique camera lays it across the frame on the
 * diagonal, so more than half of a 1504 × 300 frame comes back as clear colour
 * (measured: 47 % of it is the model). The single-car frames are already 80–93 % full
 * and are left exactly as the capture framed them. Trimming here rather than in the
 * camera keeps the capture honest about what it framed — the index carries the crop,
 * so the sheet draws the picture that exists instead of pretending the empty half is
 * part of it.
 *
 * The three **isometric** views are in the list for a sharper reason than tidiness. Their
 * frame is measured on the consist's own box and then padded by 1.4, and a box is not a
 * train: the corners of a 40 m consist sit far outside its own silhouette, so the frame
 * comes back nearly half again as big as anything drawn. Nothing is *wrong* with such a
 * picture — every pixel of the train is in it — but a sheet that drops it into a drawing
 * frames its own scene to a mostly empty rectangle, and the drawing shrinks inside it. The
 * crop is what makes the picture the size of the train.
 */
const TRIM = new Set(['consist', 'iso-A', 'iso-B', 'iso-B1', 'iso-L'])

/** A PNG's pixel size, straight out of its IHDR — no image library needed. */
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * Crop a PNG to the pixels that are not the frame's own background, in the browser
 * that owns them.
 *
 * A frame rendered on a **clear colour** is opaque, and the clear colour is exact in a
 * PNG, so a per-channel delta of 2 finds the model's own black parts (its bogies and its
 * door leaves) without being fooled by the antialiasing along an edge. A frame rendered
 * **transparent** has no such colour — its background is alpha 0 — so the model is
 * whatever has alpha. The pixel at the frame's own corner says which of the two this is,
 * rather than a second list to keep in step with `SHOW`.
 */
const trimPng = (session, dataUrl) =>
  session.evaluate(`(async () => {
    const img = new Image()
    await new Promise((ok, bad) => {
      img.onload = ok
      img.onerror = () => bad(new Error('a train picture would not decode'))
      img.src = ${JSON.stringify(dataUrl)}
    })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    const transparent = d[3] < 8
    const r0 = d[0], g0 = d[1], b0 = d[2]
    const clear = (i) =>
      transparent
        ? d[i + 3] < 8
        : (Math.abs(d[i] - r0) <= 2 && Math.abs(d[i + 1] - g0) <= 2 && Math.abs(d[i + 2] - b0) <= 2)
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4
        if (clear(i)) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (x1 < 0) return null
    const m = 6
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m)
    x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m)
    const w = x1 - x0 + 1, h = y1 - y0 + 1
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h)
    return { png: out.toDataURL('image/png'), rect: { x: x0, y: y0, width: w, height: h } }
  })()`)

/**
 * Restate a picture's layout for a crop of it.
 *
 * A crop **moves the anchor and shrinks the frame**; it does not rescale the drawing. `metres`
 * is the picture's own width in the kit's metres, so the window that was kept is that much less
 * of it — and the model's origin keeps the pixel it had, as a fraction of the smaller window.
 * A sheet then draws a cropped picture with exactly the arithmetic it used for the whole frame.
 */
function cropLayout(piece, rect, full) {
  const sx = rect.width / full.width
  const sy = rect.height / full.height
  if (piece.metres != null) piece.metres *= sx
  if (piece.verticalMetres != null) piece.verticalMetres *= sy
  if (piece.origin) {
    piece.origin = [
      (piece.origin[0] * full.width - rect.x) / rect.width,
      (piece.origin[1] * full.height - rect.y) / rect.height,
    ]
  }
  return piece
}

/* ------------------------------------------------------------- trim in place */

if (TRIM_ONLY) {
  const indexPath = join(outDir, 'index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  // A page is only needed for its canvas: serve the pictures and open one, so the
  // document is an HTML wrapper rather than an image or an SVG.
  const server = await serveDir(outDir, PORT)
  const first = index.pieces.find((p) => p.file)?.file ?? 'index.json'
  const session = await withPage({
    url: `http://127.0.0.1:${PORT}/${encodeURIComponent(first)}`,
    profile: join(repo, '.preview', `.chrome-train-trim-${process.pid}`),
    debugPort: DEBUG_PORT,
  })
  try {
    for (const piece of index.pieces) {
      if (!TRIM.has(piece.id)) continue
      const file = join(outDir, piece.file)
      const before = readFileSync(file)
      const full = pngSize(before)
      const cut = await trimPng(session, `data:image/png;base64,${before.toString('base64')}`)
      if (!cut) {
        console.log(`  ${piece.id}: nothing but background, left alone`)
        continue
      }
      writeFileSync(file, Buffer.from(cut.png.split(',')[1], 'base64'))
      piece.crop = cut.rect
      cropLayout(piece, cut.rect, full)
      piece.px = pngSize(readFileSync(file))
      console.log(`  ${piece.id}: cropped to ${piece.px.width}x${piece.px.height}`)
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 1))
    console.log(`trim-only: ${outDir}`)
  } finally {
    await session.close()
    server.close()
  }
  process.exit(0)
}

/* ------------------------------------------------------------------ a render */

const server = await serveDir(DIST, PORT)
const session = await withPage({
  url: `http://127.0.0.1:${PORT}/?capture-trains`,
  profile: join(repo, '.preview', `.chrome-train-cards-${process.pid}`),
  debugPort: DEBUG_PORT,
  verbose: Boolean(process.env.TRAINS_VERBOSE),
})

try {
  await waitFor(session.evaluate, '!!window.__trainCards && !!window.__trainCardsReady', {
    what: 'the train capture pass',
  })

  const result = await session.evaluate(`(async () => {
    const { trainPieces, captureTrains, stockTable, cabinFacts, liveryTable } = window.__trainCards
    const wanted = trainPieces('#0d141d')
    const shots = await captureTrains(wanted.frames)
    const pixels = new Map(shots.map((s) => [s.id, s.png]))
    const frames = new Map(wanted.frames.map((f) => [f.id, f]))
    const origins = new Map(shots.map((s) => [s.id, s.origin ?? null]))
    const fitted = new Map(shots.map((s) => [s.id, s.frameMetres ? [s.frameMetres, s.frameVertical] : null]))
    // The fitted views measure their own box, so the box a sheet gets is the one that was
    // framed rather than a second statement of it. trainPieces has none for those.
    const boxes = new Map(shots.map((s) => [s.id, s.box ?? null]))
    return {
      pieces: wanted.pieces.map((p) => ({
        ...p,
        frame: frames.get(p.id) ?? null,
        origin: origins.get(p.id) ?? null,
        box: boxes.get(p.id) ?? p.box ?? null,
        metres: fitted.get(p.id)?.[0] ?? p.metres ?? null,
        verticalMetres: fitted.get(p.id)?.[1] ?? p.verticalMetres ?? null,
        png: pixels.get(p.id) ?? null,
      })),
      stock: stockTable(),
      cabin: cabinFacts(),
      livery: liveryTable(),
    }
  })()`)

  const pieces = result?.pieces
  if (!Array.isArray(pieces) || !pieces.length) throw new Error('the capture pass returned no pictures')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const index = []
  for (const piece of pieces) {
    if (!piece?.png) throw new Error(`no pixels came back for ${piece?.id ?? 'a picture'}`)
    let png = String(piece.png)
    let crop = null
    const full = pngSize(Buffer.from(png.split(',')[1], 'base64'))
    if (TRIM.has(piece.id)) {
      const cut = await trimPng(session, png)
      if (cut) {
        png = cut.png
        crop = cut.rect
        cropLayout(piece, cut.rect, full)
      }
    }
    const buffer = Buffer.from(png.split(',')[1], 'base64')
    const file = `${piece.id}.png`
    writeFileSync(join(outDir, file), buffer)
    index.push({
      id: piece.id,
      label: piece.label,
      note: piece.note,
      metres: piece.metres ?? null,
      kind: piece.kind ?? null,
      verticalMetres: piece.verticalMetres ?? null,
      box: piece.box ?? null,
      frame: piece.frame ? { width: piece.frame.width, height: piece.frame.height } : null,
      // Where the model's origin lands in the picture, for a view with no horizontal datum.
      origin: piece.origin ?? null,
      file,
      crop,
      px: pngSize(buffer),
    })
  }
  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify({ pieces: index, stock: result.stock, cabin: result.cabin, livery: result.livery }, null, 1),
  )
  console.log(`train pictures: ${index.length} rendered -> ${outDir}`)
  console.log(index.map((p) => `${p.id} ${p.px.width}x${p.px.height}${p.crop ? ' (cropped)' : ''}`).join(', '))
  console.log(
    `stock: ${result.stock.map((s) => `${s.cls} ${s.length}×${s.width}×${s.height} ${s.doorsPerSide}门`).join(' | ')}`,
  )
} finally {
  await session.close()
  server.close()
}
