// Concept sheet 11 — the rolling stock in 3D.
//
// Sheet 05 gives the numbers; this sheet is the shape, and the shape is the game's:
// every picture is `buildTrain` — the consist the game runs down a platform — built
// with the model kit's own materials and captured by `tools/render-train-cards.mjs`
// into `.preview/train-cards/`. So the rounded body, the glazing band, the livery
// broken at every doorway, the sliding leaves, the lining behind the seats and the two
// bogies are the ones a player watches a crowd board.
//
// Nothing on this sheet draws a train. Where it points at one, it points with a
// leader at a part of the picture rather than at a shape of its own.
//
// Real captured door poses loop on a fixed frame, keeping the reference dimensions still.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUL, T, n, sheet, title } from './iso.mjs'
import { loadTrainAnimation, animatedTrain } from './train-animation.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
/** Where `node tools/render-train-cards.mjs` leaves its pixels and its index. */
const CARDS = resolve(repo, process.env.TRAIN_CARDS_DIR ?? join('.preview', 'train-cards'))

/** The game's own palette, from the custom properties in `game/src/styles.css`. */
const G = {
  text: '#d6e7f7',
  muted: '#7ea6c9',
  accent: '#55b6ff',
}

const W = 1600

/** The four class specimens, across the top. */
const CAR_W = 360
const CAR_PITCH = 372
const CAR_X = 48

/** A PNG's pixel size, straight out of its IHDR. */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24)
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

/**
 * The train pictures and their class index, or a clear failure.
 *
 * The render needs a browser and the game's build, so it is a separate step by design
 * (`tools/render-train-cards.mjs`); a sheet that silently drew nothing would be worse
 * than one that stops.
 */
function loadCars() {
  const indexPath = join(CARDS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no rendered rolling stock in ${CARDS} — run:\n  npm run build:game\n  node tools/render-train-cards.mjs`,
    )
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const pieces = new Map()
  for (const piece of index.pieces) {
    const file = join(CARDS, piece.file)
    if (!existsSync(file)) throw new Error(`train image is missing: ${piece.file}`)
    pieces.set(piece.id, {
      ...piece,
      // The capture supersamples at 2×, so a picture's own pixels are twice the size
      // it is drawn at; the crop a wide frame carries is already in those pixels.
      px: pngSize(file),
      href: `data:image/png;base64,${readFileSync(file).toString('base64')}`,
    })
  }
  return { pieces, stock: index.stock }
}

/* -------------------------------------------------------------------- sheet */

export function artTrains3D() {
  const poses = loadTrainAnimation()
  const { pieces, stock } = loadCars()
  const car = (id) => {
    const p = pieces.get(id)
    if (!p) throw new Error(`the capture has no \`${id}\` — re-run tools/render-train-cards.mjs`)
    return p
  }
  const image = (piece, x, y, w = piece.px.width / 2, h = piece.px.height / 2) =>
    animatedTrain(poses, piece.id, x, y, w, h)
      ?? `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${piece.href}"/>`
  const head = (x, y, text, col = G.accent) => T(x, y, text, { size: 12.5, weight: 800, fill: col, ls: 1.2 })

  const g = []
  g.push(
    title(
      48,
      62,
      '四个等级，四种车体',
      '圆角车体、玻璃带、在门口断开的涂装、两扇滑门、车里的座椅，和两条转向架。第 05 张给参数，这张给形状。',
    ),
  )

  /* ---------------- the four classes ---------------- */
  g.push(head(48, 186, '四个等级'))
  stock.forEach((s) => {
    const x = CAR_X + i * CAR_PITCH
    const piece = car(`car-${s.cls}`)
    g.push(T(x, 220, `${s.cls} 型`, { size: 22, weight: 800, fill: G.text }))
    g.push(image(piece, x, 234, CAR_W, (CAR_W / piece.px.width) * piece.px.height))
  })

  /* ---------------- two details ---------------- */
  const detailY = 486
  g.push(head(48, detailY, '开着门'))
  g.push(head(640, detailY, '车头'))
  const open = car('open')
  const nose = car('nose')
  const ow = 520
  g.push(image(open, 48, detailY + 16, ow, (ow / open.px.width) * open.px.height))
  const nw = 460
  g.push(image(nose, 640, detailY + 16, nw, (nw / nose.px.width) * nose.px.height))
  const detailBottom = detailY + 16 + Math.max((ow / open.px.width) * open.px.height, (nw / nose.px.width) * nose.px.height)

  /* ---------------- the cabin both the model and the sim use ---------------- */
  g.push(head(1160, detailY, '车厢里能站人'))
  g.push(
    MUL(1160, detailY + 28, [
      '乘客会进入车厢，不会停在车旁。',
      '停靠后，乘客从车门上下车；',
      '站台门开口与车门位置对齐。',
    ], { size: 11.5, fill: G.muted, lh: 18 }),
  )

  return sheet(W, Math.ceil(Math.max(detailBottom, detailY + 200) + 40), g.join(''))
}
