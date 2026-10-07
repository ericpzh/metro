// The game's own 扶梯 and 楼梯, laid into an isometric drawing.
//
// `tools/render-piece-views.mjs` photographs them on the drawing kit's axes and leaves a
// picture plus the layout it was drawn with — the frame, the pixels, and the point the model's
// **origin** landed on. All three are needed. A sheet that scales a picture by its frame alone
// draws the piece at whatever size the frame happened to be; one that anchors by the origin
// cannot float the run it is drawing; and a sheet with only the pixels cannot tell whether the
// capture was made at one scale or two.
//
// This is the same idea as `isoCar` in `train-iso.mjs` — a photographed model placed into a
// scene drawn with `tools/iso.mjs` — with one difference that the runs force. A **car** is a
// thing the drawing has no opinion about, so it goes in at its own scale and nothing else
// changes. A **run** is circulation: the floors it connects belong to the drawing, so the
// picture is scaled to reach them, and a sheet reads that as the run's rise.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { n, TW, ZU } from './iso.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
export const PIECE_VIEWS = resolve(repo, process.env.PIECE_VIEWS_DIR ?? join('.preview', 'piece-views'))

/** Every view, keyed by piece id, with its pixels inlined and its layout beside it. */
let cached = null
export function loadPieceViews() {
  if (cached) return cached
  const indexPath = join(PIECE_VIEWS, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(
      `no rendered piece views in ${PIECE_VIEWS} — run:\n  npm run build:game\n  node tools/render-piece-views.mjs`,
    )
  }
  cached = new Map(
    JSON.parse(readFileSync(indexPath, 'utf8')).pieces.map((p) => [
      p.id,
      { ...p, href: `data:image/png;base64,${readFileSync(join(PIECE_VIEWS, p.file)).toString('base64')}` },
    ]),
  )
  return cached
}

/** One piece's picture and layout, or a failure that says how to make it. */
export function pieceView(id) {
  const piece = loadPieceViews().get(id)
  if (!piece) throw new Error(`the capture has no \`${id}\` — re-run tools/render-piece-views.mjs`)
  return piece
}

/**
 * A run of the game's own circulation, drawn between the two landings of a scene.
 *
 * `from` and `to` are the world points the run **starts and ends on** — the lower landing and
 * the upper one — already projected by the drawing's own `P()`. `rise` is how far apart those
 * two points are **in height**; it is stated rather than read off the pair, because a projected
 * point has no third component to read it from.
 *
 * The picture is placed by three facts and no constants:
 *
 *   * its **origin** — a 扶梯's lower landing node, a 楼梯's lower landing cell, reported by the
 *     capture — goes on `from`, which is what stops a run from floating;
 *   * the height of the **drawn piece**, `content[3] − origin[1]` of the frame, is scaled to the
 *     drawing's own rise, so the head of the run lands on the floor `to` is on;
 *   * its **drawn width** is scaled only by `fill` — how much of the span between the two
 *     landings the piece's own reach is drawn to cover.
 *
 * `content` is what makes the first scaling honest: a frame is a rectangle drawn around a piece
 * that is not one, so the clear margin beside a 扶梯's picture is not a metre of escalator, and
 * scaling the *frame* to the rise would leave the run hanging above the floor it starts from.
 *
 * `fill` is where a drawing and a model genuinely disagree, and it is stated rather than hidden.
 * The game builds a 扶梯 and a 楼梯 for one 4 m storey; this station's floors are further apart,
 * and the piece's own reach — `metres × (content' width)`, at the scale the rise forced — covers
 * only part of the way. At 1 the run is stretched until its head meets the upper landing, which
 * is a escalator of no particular gradient; at the piece's own aspect it stops short of the
 * landing and leaves the rest of the span to the drawing. Anything in between is a compromise a
 * reader can see, which is the point: a run drawn to reach is a run drawn at a gradient the game
 * does not have.
 *
 * `K` is the scene group's own scale, so a run is drawn at the size a box beside it is.
 */
export function runImage(piece, K, from, to, o = {}) {
  const rise = o.rise
  if (!(rise > 0)) throw new Error(`a run of \`${piece.id}\` needs the rise between its two landings`)
  // One unit of the frame, in the drawing's scene units. A frame unit is a metre of the piece in
  // the capture's linear space; the drawing spends `TW * K` of its scene on a metre of ground and
  // the frame's width is measured on the projection's across row, which that row is `√2` longer
  // than — so the two agree on height and differ across, exactly as `iso.mjs` draws them.
  const perFrame = TW * K * Math.SQRT2
  const frameW = piece.metres * perFrame
  const frameH = piece.verticalMetres * perFrame
  const ky = (rise * ZU * K) / (frameH * (piece.content[3] - piece.origin[1]))
  const fill = o.fill ?? 1
  const span = Math.abs(to[0] - from[0])
  const drawnW = frameW * (piece.content[2] - piece.content[0])
  const kx = (span * fill) / drawnW
  const w = frameW * kx
  const h = frameH * ky
  const left = from[0] - piece.content[0] * w
  const top = from[1] - piece.origin[1] * h
  const flip = o.flip ? ` transform="translate(${n(2 * left + w)},0) scale(-1,1)"` : ''
  return `<image x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" href="${piece.href}"${flip}/>`
}
